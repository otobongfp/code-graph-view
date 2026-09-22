import * as vscode from 'vscode';
import { buildDiffGraph, buildGraph, clearGraphCache, DEPENDENCY_DIRS, diffRepoRoot, dropEmptyCalls } from './graphBuilder';
import { getGitStatusSummary, listRecentCommits } from './git';
import { getSignature } from './signatureProvider';
import { ContextBucketManager } from './contextBucket';
import { DiffInfo, ExtensionToWebviewMessage, GraphData, SearchResult, WebviewToExtensionMessage } from './types';

interface Target {
  uri: vscode.Uri;
  position?: vscode.Position;
  label: string;
  /** Set when this root is a git diff ('uncommitted', 'unstaged', 'staged', 'branch', 'commit:<sha>'). */
  diff?: string;
}

const DIFF_LABELS: Record<string, string> = {
  uncommitted: 'Uncommitted changes',
  unstaged: 'Unstaged changes',
  staged: 'Staged changes',
  branch: 'This branch vs main / origin',
};

const isText = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const LEVELS = new Set(['name', 'signature', 'full']);

/** The webview is our own page, but everything it shows comes from code and git, so check messages before acting. */
function isValidMessage(m: WebviewToExtensionMessage): boolean {
  if (!m || typeof m !== 'object' || typeof m.command !== 'string') {
    return false;
  }
  switch (m.command) {
    case 'openFile':
    case 'explore':
    case 'signature':
      return isText(m.file) && isIndex(m.line) && isIndex(m.character);
    case 'focus':
      return isText(m.file) && (m.line === undefined || isIndex(m.line)) && (m.character === undefined || isIndex(m.character));
    case 'goTo':
      return isIndex(m.index);
    case 'diff':
      return isText(m.source, 200);
    case 'search':
      return typeof m.query === 'string' && m.query.length <= 500 && isIndex(m.id);
    case 'addToBucket':
      return (
        Array.isArray(m.items) &&
        m.items.length <= 500 &&
        m.items.every((i) => i && isText(i.id) && isText(i.file) && isText(i.name, 512) && isIndex(i.line ?? 0) && isIndex(i.character ?? 0))
      );
    case 'removeFromBucket':
      return isText(m.id);
    case 'updateBucketLevel':
      return isText(m.id) && LEVELS.has(m.level);
    case 'exportDiagram':
      return (
        (m.format === 'svg' || m.format === 'png' || m.format === 'mermaid') &&
        (m.action === 'save' || m.action === 'copy') &&
        typeof m.data === 'string' &&
        m.data.length <= 15 * 1024 * 1024
      );
    default:
      return true;
  }
}

function makeDiffTarget(source: string, hintTarget?: Target): Target {
  const folder = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : undefined;
  const uri = hintTarget?.uri ?? (folder ?? vscode.workspace.workspaceFolders?.[0])?.uri ?? vscode.Uri.file('/');
  const label = DIFF_LABELS[source] ?? (source.startsWith('branch:') ? `This branch vs ${source.slice(7)}` : `Commit ${source.replace('commit:', '')}`);
  return { uri, label: `Δ ${label}`, diff: source };
}

const MAX_HISTORY = 50;
const EXPLORE_DEPTH = 10;
const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,go,rs,py,java,cs,c,cpp,cc,cxx,h,hpp,php,kt,kts,dart,rb,swift,scala,sc,zig,lua}';
const SOURCE_EXCLUDE = '{**/{node_modules,dist,out,build,.git,vendor,target,.venv,venv,site-packages,__pycache__,.gradle,obj,.dart_tool,.build,.swiftpm,.metals,.bloop}/**,**/bin/{Debug,Release,x86,x64,AnyCPU}/**}';
const MAX_FILE_RESULTS = 8;
const MAX_SYMBOL_RESULTS = 12;

/** Higher is better; -1 means no match. Substring hits in the file name beat path hits beat subsequences. */
function fuzzyScore(query: string, path: string): number {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const base = p.slice(p.lastIndexOf('/') + 1);
  const inBase = base.indexOf(q);
  if (inBase >= 0) return 1000 - inBase * 2 - base.length;
  const inPath = p.indexOf(q);
  if (inPath >= 0) return 600 - inPath - p.length * 0.1;
  let qi = 0;
  let last = -2;
  let score = 0;
  for (let i = 0; i < p.length && qi < q.length; i++) {
    if (p[i] === q[qi]) {
      score += i === last + 1 ? 3 : 1;
      if (i === 0 || '/._-'.includes(p[i - 1])) score += 2;
      last = i;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

function makeTarget(uri: vscode.Uri, line?: number, character?: number, name?: string): Target {
  const rel = vscode.workspace.asRelativePath(uri);
  if (line !== undefined && character !== undefined) {
    const base = uri.path.split('/').pop() ?? rel;
    return { uri, position: new vscode.Position(line, character), label: name ? `${base} › ${name}` : rel };
  }
  return { uri, label: rel };
}

function sameTarget(a: Target, b: Target): boolean {
  return (
    a.diff === b.diff &&
    a.uri.toString() === b.uri.toString() &&
    a.position?.line === b.position?.line &&
    a.position?.character === b.position?.character
  );
}

export class CodeGraphPanel {
  public static current: CodeGraphPanel | undefined;
  private static readonly viewType = 'codeGraphView';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private trail: Target[] = [];
  private cursor = -1;
  private seq = 0;
  private exploring = false;
  private queuedExplore: { id: string; file: string; line: number; character: number } | undefined;
  private fileIndex: Promise<vscode.Uri[]> | undefined;
  private bucketManager = ContextBucketManager.get();

  static createOrShow(extensionUri: vscode.Uri, uri: vscode.Uri) {
    CodeGraphPanel.show(extensionUri, makeTarget(uri));
  }

  static showDiff(extensionUri: vscode.Uri, source: string) {
    CodeGraphPanel.show(extensionUri, makeDiffTarget(source));
  }

  private static show(extensionUri: vscode.Uri, target: Target) {
    const column = vscode.ViewColumn.Beside;

    if (CodeGraphPanel.current) {
      CodeGraphPanel.current.panel.reveal(column);
      void CodeGraphPanel.current.navigate(target);
      return;
    }

    const panel = vscode.window.createWebviewPanel(CodeGraphPanel.viewType, 'Code Graph', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'webview')],
    });

    CodeGraphPanel.current = new CodeGraphPanel(panel, extensionUri);
    void CodeGraphPanel.current.navigate(target);
  }

  static refresh() {
    void CodeGraphPanel.current?.reload();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    const watcher = vscode.workspace.createFileSystemWatcher(SOURCE_GLOB);
    watcher.onDidCreate(() => (this.fileIndex = undefined), null, this.disposables);
    watcher.onDidDelete(() => (this.fileIndex = undefined), null, this.disposables);
    this.disposables.push(watcher);

    if (this.bucketManager) {
      this.disposables.push(
        this.bucketManager.onDidUpdate((summary) => {
          this.post({ command: 'bucketUpdated', summary });
        })
      );
    }

    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        if (!isValidMessage(message)) {
          return;
        }
        switch (message.command) {
          case 'openFile':
            void this.openFile(message.file, message.line, message.character);
            break;
          case 'requestRefresh':
            void this.reload();
            break;
          case 'back':
            this.go(this.cursor - 1);
            break;
          case 'forward':
            this.go(this.cursor + 1);
            break;
          case 'goTo':
            this.go(message.index);
            break;
          case 'diff':
            void this.navigate(makeDiffTarget(message.source, this.current()));
            break;
          case 'diffSources':
            void this.sendDiffSources();
            break;
          case 'signature':
            void this.sendSignature(message.id, message.file, message.line, message.character);
            break;
          case 'search':
            void this.search(message.query, message.id);
            break;
          case 'explore':
            void this.explore(message.id, message.file, message.line, message.character);
            break;
          case 'focus':
            void this.navigate(
              makeTarget(vscode.Uri.file(message.file), message.line, message.character, message.name)
            );
            break;
          case 'getBucket':
            void this.sendBucket();
            break;
          case 'addToBucket':
            if (this.bucketManager) {
              const summary = await this.bucketManager.addItems(message.items);
              this.post({ command: 'bucketUpdated', summary });
            }
            break;
          case 'removeFromBucket':
            if (this.bucketManager) {
              const summary = await this.bucketManager.removeItem(message.id);
              this.post({ command: 'bucketUpdated', summary });
            }
            break;
          case 'updateBucketLevel':
            if (this.bucketManager) {
              const summary = await this.bucketManager.updateLevel(message.id, message.level);
              this.post({ command: 'bucketUpdated', summary });
            }
            break;
          case 'clearBucket':
            if (this.bucketManager) {
              const summary = await this.bucketManager.clear();
              this.post({ command: 'bucketUpdated', summary });
            }
            break;
          case 'copyBucket':
            void this.copyBucket();
            break;
          case 'sendBucketToChat':
            void this.sendBucketToChat();
            break;
          case 'exportDiagram':
            void this.handleExportDiagram(message.format, message.action, message.data, message.filename);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  private async handleExportDiagram(
    format: 'svg' | 'png' | 'mermaid',
    action: 'save' | 'copy',
    data: string,
    suggestedFilename?: string
  ): Promise<void> {
    if (action === 'copy') {
      await vscode.env.clipboard.writeText(data);
      const label = format === 'mermaid' ? 'Mermaid diagram' : format === 'svg' ? 'SVG markup' : 'Image data';
      vscode.window.setStatusBarMessage(`Code Graph: ${label} copied to clipboard`, 3000);
      return;
    }

    const defaultName =
      suggestedFilename ||
      (format === 'mermaid' ? 'code-graph.mmd' : format === 'svg' ? 'code-graph.svg' : 'code-graph.png');

    const filters: Record<string, string[]> =
      format === 'mermaid'
        ? { 'Mermaid Diagram (*.mmd, *.md)': ['mmd', 'md'] }
        : format === 'svg'
        ? { 'Scalable Vector Graphics (*.svg)': ['svg'] }
        : { 'PNG Image (*.png)': ['png'] };

    const folder =
      (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) ||
      vscode.workspace.workspaceFolders?.[0];

    const defaultUri = folder ? vscode.Uri.joinPath(folder.uri, defaultName) : vscode.Uri.file(defaultName);

    const targetUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters,
      title: `Export Code Graph as ${format.toUpperCase()}`,
    });

    if (!targetUri) {
      return;
    }

    try {
      let bytes: Uint8Array;
      if (format === 'png') {
        const base64Clean = data.includes(',') ? data.split(',')[1] : data;
        bytes = Buffer.from(base64Clean, 'base64');
      } else {
        bytes = Buffer.from(data, 'utf-8');
      }

      await vscode.workspace.fs.writeFile(targetUri, bytes);
      const filename = targetUri.path.slice(targetUri.path.lastIndexOf('/') + 1);
      const choice = await vscode.window.showInformationMessage(
        `Code Graph exported to ${filename}`,
        'Open File'
      );
      if (choice === 'Open File') {
        await vscode.commands.executeCommand('vscode.open', targetUri);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to export code graph: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async copyBucket() {
    if (!this.bucketManager) return;
    const summary = await this.bucketManager.resolveSummary();
    await vscode.env.clipboard.writeText(summary.markdown);
    void vscode.window.showInformationMessage('Copied AI context to clipboard.');
  }

  private async sendBucketToChat() {
    if (!this.bucketManager) return;
    const summary = await this.bucketManager.resolveSummary();
    if (summary.items.length === 0) {
      void vscode.window.showInformationMessage('AI context is empty. Add methods first.');
      return;
    }

    interface ChatTargetItem extends vscode.QuickPickItem {
      id: 'copilot' | 'cursor' | 'continue_cline' | 'claude_cli' | 'web_ai' | 'custom' | 'explain' | 'review' | 'tests';
    }

    const targets: ChatTargetItem[] = [
      {
        id: 'copilot',
        label: '$(comment-discussion) GitHub Copilot / VS Code Chat',
        description: 'Send directly to VS Code AI Chat panel',
      },
      {
        id: 'cursor',
        label: '$(sparkle) Cursor Chat & Composer',
        description: 'Open Cursor AI Chat / copy context for Cursor (Cmd+L / Cmd+I)',
      },
      {
        id: 'custom',
        label: '$(edit) Custom Prompt / Question...',
        description: 'Type a custom question or instruction to send with this context',
      },
      {
        id: 'continue_cline',
        label: '$(robot) Continue / Cline / Roo Code / Cody',
        description: 'Copy context & trigger installed AI extension chat panel',
      },
      {
        id: 'claude_cli',
        label: '$(terminal) Claude Code CLI / Terminal',
        description: 'Copy formatted trail with prompt for Claude Code CLI',
      },
      {
        id: 'web_ai',
        label: '$(clippy) Copy for ChatGPT / Claude Web / Gemini',
        description: 'Copy clean markdown specification to clipboard',
      },
      {
        id: 'explain',
        label: '$(search) Explain this flow',
        description: 'Prompt: Analyze control & data flow across these methods',
      },
      {
        id: 'review',
        label: '$(bug) Find bugs & edge cases',
        description: 'Prompt: Review error handling and potential edge cases',
      },
      {
        id: 'tests',
        label: '$(beaker) Generate Unit Tests',
        description: 'Prompt: Generate unit tests for this call sequence',
      },
    ];

    const pick = await vscode.window.showQuickPick(targets, {
      placeHolder: 'Choose where to send context or select an AI prompt...',
      title: 'Send AI Context to Chat',
    });

    if (!pick) return;

    let promptQuery = summary.markdown;
    if (pick.id === 'custom') {
      const userPrompt = await vscode.window.showInputBox({
        prompt: 'Enter your custom instruction or question for the AI',
        placeHolder: 'e.g. How can I refactor this call path to add caching?',
      });
      if (!userPrompt) return;
      promptQuery = `${userPrompt}\n\n${summary.markdown}`;
    } else if (pick.id === 'explain') {
      promptQuery = `Please explain the control and data flow across these methods:\n\n${summary.markdown}`;
    } else if (pick.id === 'review') {
      promptQuery = `Please review this call path for potential bugs, error handling gaps, and edge cases:\n\n${summary.markdown}`;
    } else if (pick.id === 'tests') {
      promptQuery = `Please write comprehensive unit tests covering this call chain and referenced types:\n\n${summary.markdown}`;
    } else if (pick.id === 'claude_cli') {
      promptQuery = `Here is the relevant code path and signatures for my task:\n\n${summary.markdown}`;
    }

    if (pick.id === 'cursor') {
      await vscode.env.clipboard.writeText(promptQuery);
      try {
        const commands = await vscode.commands.getCommands(true);
        if (commands.includes('aichat.newchataction')) {
          await vscode.commands.executeCommand('aichat.newchataction');
        } else if (commands.includes('workbench.action.chat.open')) {
          await vscode.commands.executeCommand('workbench.action.chat.open', { query: promptQuery });
        }
      } catch {}
      void vscode.window.showInformationMessage('Copied context for Cursor! Paste into Chat (Cmd+L) or Composer (Cmd+I).');
      return;
    }

    if (pick.id === 'continue_cline') {
      await vscode.env.clipboard.writeText(promptQuery);
      try {
        const commands = await vscode.commands.getCommands(true);
        if (commands.includes('continue.focusContinueInputView')) {
          await vscode.commands.executeCommand('continue.focusContinueInputView');
        } else if (commands.includes('cline.openSidebar')) {
          await vscode.commands.executeCommand('cline.openSidebar');
        } else if (commands.includes('cody.chat.focus')) {
          await vscode.commands.executeCommand('cody.chat.focus');
        }
      } catch {}
      void vscode.window.showInformationMessage('Copied context! Paste into your AI extension panel.');
      return;
    }

    if (pick.id === 'copilot' || pick.id === 'custom' || pick.id === 'explain' || pick.id === 'review' || pick.id === 'tests') {
      try {
        const commands = await vscode.commands.getCommands(true);
        if (commands.includes('workbench.action.chat.open')) {
          await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: promptQuery,
          });
          return;
        }
      } catch {}
    }

    await vscode.env.clipboard.writeText(promptQuery);
    const targetName = pick.id === 'claude_cli' ? 'Claude Code' : pick.id === 'web_ai' ? 'AI Chat' : 'Clipboard';
    void vscode.window.showInformationMessage(`Context copied for ${targetName}! Paste into your chat or terminal.`);
  }

  private async sendBucket() {
    if (this.bucketManager) {
      const summary = await this.bucketManager.resolveSummary();
      this.post({ command: 'bucketUpdated', summary });
    }
  }

  /** Files in the diff on screen, so clicking one of them can open the change instead of just the file. */
  private diffView: { root: string; refs: NonNullable<DiffInfo['refs']>; files: Set<string>; added: Set<string> } | undefined;

  private rememberDiff(data: GraphData) {
    const info = data.diff;
    if (!info?.refs) {
      this.diffView = undefined;
      return;
    }
    const symbolIds = new Set(Object.keys(info.changes));
    const files = new Set<string>();
    for (const f of data.files) {
      if (f.symbols.some((sym) => symbolIds.has(sym.id))) files.add(f.file);
    }
    this.diffView = { root: data.rootFile, refs: info.refs, files, added: new Set(info.newFiles ?? []) };
  }

  /** The built-in git extension's API, which knows how to address a file at a ref; undefined if git is disabled. */
  private async gitApi(): Promise<{ toGitUri?: (uri: vscode.Uri, ref: string) => vscode.Uri } | undefined> {
    try {
      const ext = vscode.extensions.getExtension<{ getAPI(version: 1): { toGitUri?: (uri: vscode.Uri, ref: string) => vscode.Uri } }>('vscode.git');
      if (!ext) return undefined;
      const exports = ext.isActive ? ext.exports : await ext.activate();
      return exports.getAPI(1);
    } catch {
      return undefined;
    }
  }

  /** Opens VS Code's own before/after view of `file` at the method; false if it can't, so the caller opens the plain file. */
  private async openDiff(file: string, line: number, character: number): Promise<boolean> {
    const view = this.diffView;
    if (!view || !view.files.has(file) || view.added.has(file)) return false;
    const { left, right } = view.refs;
    if (left === null) return false;
    try {
      const uri = vscode.Uri.file(file);
      const gitApi = await this.gitApi();
      const at = (ref: string): vscode.Uri =>
        gitApi?.toGitUri?.(uri, ref) ?? uri.with({ scheme: 'git', query: JSON.stringify({ path: uri.fsPath, ref }) });
      const position = new vscode.Position(line, character);
      await vscode.commands.executeCommand(
        'vscode.diff',
        at(left),
        right === null ? uri : at(right),
        `${vscode.workspace.asRelativePath(uri)} (${this.panel.title.replace(/^Code Graph: Δ /, '')})`,
        { viewColumn: vscode.ViewColumn.One, preserveFocus: false, selection: new vscode.Range(position, position) }
      );
      return true;
    } catch {
      return false;
    }
  }

  private async openFile(file: string, line: number, character: number) {
    if (await this.openDiff(file, line, character)) return;
    const doc = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });
    const position = new vscode.Position(line, character);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  private current(): Target | undefined {
    return this.trail[this.cursor];
  }

  /** Moves to a new root, dropping any forward entries the way a browser does. */
  private async navigate(next: Target) {
    const here = this.current();
    if (here && sameTarget(here, next)) {
      await this.load();
      return;
    }
    this.trail = this.trail.slice(0, this.cursor + 1);
    this.trail.push(next);
    if (this.trail.length > MAX_HISTORY) {
      this.trail.shift();
    }
    this.cursor = this.trail.length - 1;
    await this.load();
  }

  private go(index: number) {
    if (index < 0 || index >= this.trail.length || index === this.cursor) {
      return;
    }
    this.cursor = index;
    void this.load();
  }

  private reload() {
    clearGraphCache();
    return this.load();
  }

  private postGraph(data: GraphData, partial = false) {
    this.rememberDiff(data);
    this.post({ command: 'graphData', data, trail: this.trail.map((t) => t.label), cursor: this.cursor, partial });
  }

  private async load() {
    const target = this.current();
    if (!target) {
      return;
    }
    const seq = ++this.seq;
    this.panel.title = `Code Graph: ${target.label}`;
    this.post({ command: 'loading' });
    try {
      const onProgress = (snapshot: GraphData) => {
        if (seq === this.seq) {
          this.postGraph(snapshot, true);
        }
      };
      if (target.diff) {
        const changes = await buildDiffGraph(target.diff, { onProgress, targetUri: target.uri });
        if (seq !== this.seq) {
          return;
        }
        this.postGraph(changes);
        if (changes.roots.length > 0 && changes.edges.length === 0) {
          // A cold language server answers with nothing; give it a moment and look once more.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (seq !== this.seq) {
            return;
          }
          dropEmptyCalls();
          const again = await buildDiffGraph(target.diff, { targetUri: target.uri });
          if (seq === this.seq && again.edges.length > changes.edges.length) {
            this.postGraph(again);
          }
        }
        return;
      }
      // The language server only answers well for files it has seen, so make sure it has this one.
      await vscode.workspace.openTextDocument(target.uri);
      const data = await buildGraph(target, { onProgress });
      if (seq !== this.seq) {
        return;
      }
      this.postGraph(data);

      if (data.roots.length === 0 || data.edges.length === 0) {
        // A cold language server answers with nothing; give it a moment and look once more.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (seq !== this.seq) {
          return;
        }
        dropEmptyCalls();
        const again = await buildGraph(target);
        if (seq === this.seq && (again.roots.length > data.roots.length || again.edges.length > data.edges.length)) {
          this.postGraph(again);
        }
      }
    } catch (err) {
      if (seq === this.seq) {
        this.post({ command: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  /** One deep crawl at a time; if the user clicks on, only the newest waiting request is kept. */
  private async explore(id: string, file: string, line: number, character: number) {
    if (this.exploring) {
      if (this.queuedExplore) {
        this.post({ command: 'exploreResult', id: this.queuedExplore.id });
      }
      this.queuedExplore = { id, file, line, character };
      return;
    }
    this.exploring = true;
    try {
      const data = await buildGraph(
        { uri: vscode.Uri.file(file), position: new vscode.Position(line, character) },
        { maxDepth: EXPLORE_DEPTH }
      );
      this.post({ command: 'exploreResult', id, data });
    } catch {
      this.post({ command: 'exploreResult', id });
    } finally {
      this.exploring = false;
      const next = this.queuedExplore;
      this.queuedExplore = undefined;
      if (next) {
        void this.explore(next.id, next.file, next.line, next.character);
      }
    }
  }

  private async sendSignature(id: number, file: string, line: number, character: number) {
    try {
      const data = await getSignature(vscode.Uri.file(file), new vscode.Position(line, character));
      this.post({ command: 'signatureResult', id, data });
    } catch (err) {
      this.post({ command: 'signatureResult', id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async sendDiffSources() {
    try {
      const root = await diffRepoRoot(this.current()?.uri);
      const summary = await getGitStatusSummary(root);
      this.post({ command: 'diffSources', commits: summary.commits, summary });
    } catch (err) {
      this.post({ command: 'diffSources', commits: [], error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async search(query: string, id: number) {
    const q = query.trim();
    if (!q) {
      this.post({ command: 'searchResults', id, results: [] });
      return;
    }
    const [files, symbols] = await Promise.all([this.searchFiles(q), this.searchSymbols(q)]);
    this.post({ command: 'searchResults', id, results: [...files, ...symbols] });
  }

  private async searchFiles(q: string): Promise<SearchResult[]> {
    this.fileIndex ??= Promise.resolve(vscode.workspace.findFiles(SOURCE_GLOB, SOURCE_EXCLUDE, 20000));
    const uris = await this.fileIndex;
    return uris
      .map((uri) => {
        const rel = vscode.workspace.asRelativePath(uri);
        return { uri, rel, score: fuzzyScore(q, rel) };
      })
      .filter((hit) => hit.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FILE_RESULTS)
      .map(({ uri, rel }) => {
        const slash = rel.lastIndexOf('/');
        return {
          kind: 'file' as const,
          label: rel.slice(slash + 1),
          detail: slash >= 0 ? rel.slice(0, slash) : '.',
          file: uri.fsPath,
          line: 0,
          character: 0,
        };
      });
  }

  private async searchSymbols(q: string): Promise<SearchResult[]> {
    try {
      const symbols =
        (await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', q)) ?? [];
      const out: SearchResult[] = [];
      for (const symbol of symbols) {
        const kind =
          symbol.kind === vscode.SymbolKind.Function
            ? 'function'
            : symbol.kind === vscode.SymbolKind.Method
              ? 'method'
              : symbol.kind === vscode.SymbolKind.Class
                ? 'class'
                : undefined;
        const uri = symbol.location.uri;
        if (!kind || uri.scheme !== 'file' || DEPENDENCY_DIRS.test(uri.path)) continue;
        const start = symbol.location.range.start;
        out.push({
          kind,
          label: symbol.name,
          detail: `${symbol.containerName ? `${symbol.containerName} · ` : ''}${vscode.workspace.asRelativePath(uri)}`,
          file: uri.fsPath,
          line: start.line,
          character: start.character,
        });
        if (out.length >= MAX_SYMBOL_RESULTS) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  private post(message: ExtensionToWebviewMessage) {
    void this.panel.webview.postMessage(message);
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.js')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
  />
  <title>Code Graph</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); }
    #app { width: 100%; height: 100vh; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    CodeGraphPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
