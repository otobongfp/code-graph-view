import * as path from "path";
import * as vscode from "vscode";
import { compareCallables } from "./signatureDiff";
import { parseCallable, parseGenericCallable } from "./tsSignature";
import { findRemoved } from "./removedCode";
import { computeDiff, mapLineBack, readAtRef, repoRootFor } from "./git";
import { CallEdge, DiffInfo, FileNode, GraphData, SymbolRow } from "./types";

const VARIABLE_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Variable,
  vscode.SymbolKind.Constant,
]);

const TEST_FILE =
  /(\.(spec|test)\.[cm]?[jt]sx?$)|(_test\.go$)|(test_.*\.py$)|(.*_test\.py$)|(Test.*\.java$)|(.*Test\.java$)|(.*Tests?\.cs$)|(.*_test\.(cpp|cc|cxx|c)$)|(.*Test\.php$)|(.*Test\.kt$)|(.*_test\.dart$)|(.*_(test|spec)\.rb$)|(test_.*\.rb$)|(.*Tests?\.swift$)|(.*(Spec|Suite|Test)\.scala$)|(.*_test\.zig$)|(.*_(spec|test)\.lua$)|(\/__tests__\/)/i;

const MAX_ROOT_SYMBOLS = 200;
const MAX_SYMBOLS = 400;
const MAX_CALLS_PER_SYMBOL = 50;
const ROOT_CONCURRENCY = 6;
const HOP_CONCURRENCY = 6;
const SESSION_WINDOW = 7;

type Direction = "incoming" | "outgoing";

export interface GraphTarget {
  uri: vscode.Uri;
  /** Selection start of a method; when set the graph is rooted at just that method. */
  position?: vscode.Position;
}

function idOf(uri: vscode.Uri, pos: vscode.Position): string {
  return `${uri.toString()}#${pos.line}:${pos.character}`;
}

function itemId(item: vscode.CallHierarchyItem): string {
  return idOf(item.uri, item.selectionRange.start);
}

function baseName(uri: vscode.Uri): string {
  return uri.path.split("/").pop() ?? uri.path;
}

/** Third-party and generated code: dependencies (node_modules, Go vendor, Python environments) and build output. */
export const DEPENDENCY_DIRS = /\/(node_modules|vendor|target|\.venv|venv|site-packages|__pycache__|\.gradle|build|bin\/(?:Debug|Release|x86|x64|AnyCPU)|obj|\.dart_tool|\.build|\.swiftpm|\.metals|\.bloop)\//;

export function isWorkspaceFile(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file" || DEPENDENCY_DIRS.test(uri.path)) {
    return false;
  }
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  return hasWorkspace ? !!vscode.workspace.getWorkspaceFolder(uri) : true;
}

/** Runs `fn` over `items` with at most `limit` in flight, starting the next as soon as one finishes. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

interface NodeRef {
  id: string;
  uri: vscode.Uri;
  name: string;
  kind: vscode.SymbolKind;
  pos: vscode.Position;
}

// One-hop answers are remembered as plain data (never as call-hierarchy items) and dropped on save or Refresh.
// An empty answer may just mean the language server hasn't loaded the file yet, so those expire quickly.
const EMPTY_TTL_MS = 10_000;
const hopCache = new Map<string, { nodes: NodeRef[]; at: number }>();

export function clearGraphCache() {
  hopCache.clear();
}

export function dropEmptyCalls() {
  for (const [key, entry] of hopCache) {
    if (entry.nodes.length === 0) {
      hopCache.delete(key);
    }
  }
}

class Registry {
  private readonly files = new Map<string, FileNode>();
  private readonly rows = new Map<string, SymbolRow>();

  get size(): number {
    return this.rows.size;
  }

  has(id: string): boolean {
    return this.rows.has(id);
  }

  register(
    uri: vscode.Uri,
    name: string,
    kind: vscode.SymbolKind,
    pos: vscode.Position,
  ): string {
    const id = idOf(uri, pos);
    if (this.rows.has(id)) {
      return id;
    }
    const fileId = uri.toString();
    let file = this.files.get(fileId);
    if (!file) {
      file = {
        id: fileId,
        label: vscode.workspace.asRelativePath(uri),
        file: uri.fsPath,
        symbols: [],
      };
      this.files.set(fileId, file);
    }
    const row: SymbolRow = {
      id,
      name,
      kind:
        kind === vscode.SymbolKind.Method ||
        kind === vscode.SymbolKind.Constructor
          ? "method"
          : "function",
      line: pos.line,
      character: pos.character,
    };
    this.rows.set(id, row);
    file.symbols.push(row);
    return id;
  }

  registerNode(node: NodeRef): string {
    return this.register(node.uri, node.name, node.kind, node.pos);
  }

  toFiles(rootFileId: string): FileNode[] {
    const files = [...this.files.values()];
    for (const file of files) {
      file.symbols.sort((a, b) => a.line - b.line);
    }
    return files.sort((a, b) =>
      a.id === rootFileId
        ? -1
        : b.id === rootFileId
          ? 1
          : a.label.localeCompare(b.label),
    );
  }
}

export async function getDocumentSymbols(
  uri: vscode.Uri,
): Promise<vscode.DocumentSymbol[]> {
  const result = await vscode.commands.executeCommand<
    vscode.DocumentSymbol[] | undefined
  >("vscode.executeDocumentSymbolProvider", uri);
  return result ?? [];
}

function collectCandidates(
  symbols: vscode.DocumentSymbol[],
  isCallable: (kind: vscode.SymbolKind) => boolean,
  out: vscode.DocumentSymbol[] = [],
) {
  for (const symbol of symbols) {
    if (isCallable(symbol.kind) || VARIABLE_KINDS.has(symbol.kind)) {
      out.push(symbol);
    } else if (symbol.children.length) {
      collectCandidates(symbol.children, isCallable, out);
    }
  }
  return out;
}

/** Deepest symbol whose full range contains `pos`, so a position on `export`/`async` still finds the method. */
export function symbolAt(
  symbols: vscode.DocumentSymbol[],
  pos: vscode.Position,
): vscode.DocumentSymbol | undefined {
  for (const symbol of symbols) {
    if (symbol.range.contains(pos)) {
      return symbolAt(symbol.children, pos) ?? symbol;
    }
  }
  return undefined;
}

const refOf = (item: vscode.CallHierarchyItem): NodeRef => ({
  id: itemId(item),
  uri: item.uri,
  name: item.name,
  kind: item.kind,
  pos: item.selectionRange.start,
});

/** A method plus, when we hold one, its live lookup and how many lookups had been made when it was created. */
interface Handle {
  node: NodeRef;
  item?: vscode.CallHierarchyItem;
  epoch: number;
}

let epoch = 0;

async function prepareFresh(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<Handle | undefined> {
  try {
    const items = await vscode.commands.executeCommand<
      vscode.CallHierarchyItem[] | undefined
    >("vscode.prepareCallHierarchy", uri, position);
    const item = items?.[0];
    return item ? { node: refOf(item), item, epoch: ++epoch } : undefined;
  } catch {
    return undefined;
  }
}

/** Direct callers or callees of `handle`, from the cache when possible, otherwise from a live lookup. */
async function oneHop(handle: Handle, direction: Direction): Promise<Handle[]> {
  const key = `${direction}:${handle.node.id}`;
  const cached = hopCache.get(key);
  if (
    cached &&
    (cached.nodes.length > 0 || Date.now() - cached.at < EMPTY_TTL_MS)
  ) {
    return cached.nodes.map((node) => ({ node, epoch: -1 }));
  }

  let current = handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    const stale = !current.item || epoch - current.epoch > SESSION_WINDOW;
    if (stale) {
      const fresh = await prepareFresh(current.node.uri, current.node.pos);
      if (!fresh) return [];
      current = fresh;
    }
    try {
      const item = current.item!;
      let items: vscode.CallHierarchyItem[];
      if (direction === "incoming") {
        const calls = await vscode.commands.executeCommand<
          vscode.CallHierarchyIncomingCall[] | undefined
        >("vscode.provideIncomingCalls", item);
        items = (calls ?? []).map((c) => c.from);
      } else {
        const calls = await vscode.commands.executeCommand<
          vscode.CallHierarchyOutgoingCall[] | undefined
        >("vscode.provideOutgoingCalls", item);
        items = (calls ?? []).map((c) => c.to);
      }
      // Nothing back after other lookups have piled up may mean this one was dropped: look again once, freshly.
      if (
        items.length === 0 &&
        attempt === 0 &&
        epoch - current.epoch > SESSION_WINDOW
      ) {
        current = { node: current.node, epoch: -1 };
        continue;
      }
      hopCache.set(key, { nodes: items.map(refOf), at: Date.now() });
      return items.map((child) => ({
        node: refOf(child),
        item: child,
        epoch: current.epoch,
      }));
    } catch {
      return [];
    }
  }
  return [];
}

function readSettings() {
  const config = vscode.workspace.getConfiguration("codeGraphView");
  return {
    maxDepth: Math.min(8, Math.max(1, config.get<number>("maxDepth", 2))),
    includeConstructors: config.get<boolean>("includeConstructors", false),
    hideTests: config.get<boolean>("hideTests", true),
  };
}

const isCallableKind = (
  kind: vscode.SymbolKind,
  includeConstructors: boolean,
) =>
  kind === vscode.SymbolKind.Function ||
  kind === vscode.SymbolKind.Method ||
  (includeConstructors && kind === vscode.SymbolKind.Constructor);

interface RootCandidate {
  uri: vscode.Uri;
  symbol: vscode.DocumentSymbol;
}

interface CrawlConfig {
  rootFileId: string;
  rootFile: string;
  rootLabel: string;
  /** A single method to root the graph at; otherwise every candidate is a root. */
  singleRoot?: Handle;
  candidates: RootCandidate[];
  callerDepth: number;
  calleeDepth: number;
  reportedDepth: number;
  /** Files that are always tracked, whatever the hide-tests setting says. */
  exempt: Set<string>;
  truncated?: boolean;
  diff?: DiffInfo;
  onProgress?: (snapshot: GraphData) => void;
}

/**
 * Registers the roots, then follows callers up `callerDepth` hops and callees down `calleeDepth` hops from
 * each. Snapshots are handed to `onProgress` while it runs so the graph can appear before it is complete.
 */
async function crawl(cfg: CrawlConfig): Promise<GraphData> {
  const startedAt = Date.now();
  const { includeConstructors, hideTests } = readSettings();
  const reg = new Registry();
  const edges = new Map<string, CallEdge>();
  let truncated = cfg.truncated ?? false;

  const isCallable = (kind: vscode.SymbolKind) =>
    isCallableKind(kind, includeConstructors);
  const isTrackable = (u: vscode.Uri) =>
    cfg.exempt.has(u.toString()) ||
    (isWorkspaceFile(u) && !(hideTests && TEST_FILE.test(u.path)));

  let callableAttempts = 0;
  let callableResolved = 0;
  const rootIds: string[] = [];
  const rootIdSet = new Set<string>();
  const addRoot = (id: string) => {
    if (!rootIdSet.has(id)) {
      rootIdSet.add(id);
      rootIds.push(id);
    }
  };
  let rootSymbolId: string | undefined;
  if (cfg.singleRoot) {
    rootSymbolId = reg.registerNode(cfg.singleRoot.node);
    addRoot(rootSymbolId);
  } else {
    // Every method shows up straight away; the crawl below only adds their relations.
    for (const c of cfg.candidates) {
      if (isCallable(c.symbol.kind)) {
        addRoot(
          reg.register(
            c.uri,
            c.symbol.name,
            c.symbol.kind,
            c.symbol.selectionRange.start,
          ),
        );
      }
    }
  }

  const addEdge = (source: string, dest: string) => {
    const key = `${source}>${dest}`;
    if (!edges.has(key)) {
      edges.set(key, { id: key, source, target: dest });
    }
  };

  // Several methods and not one of them resolved: the language server has no call hierarchy (or isn't running),
  // which would otherwise look like "these methods call nothing".
  let notice: string | undefined;
  const snapshot = (): GraphData => {
    if (cfg.diff) {
      cfg.diff.testedBy = Object.fromEntries([...testCallers].map(([id, files]) => [id, [...files].sort()]));
    }
    return structuredClone({
      rootFile: cfg.rootFile,
      rootFileId: cfg.rootFileId,
      rootSymbolId,
      rootLabel: cfg.rootLabel,
      roots: rootIds,
      maxDepth: cfg.reportedDepth,
      files: reg.toFiles(cfg.rootFileId),
      edges: [...edges.values()],
      truncated,
      fetchMs: Date.now() - startedAt,
      diff: cfg.diff,
      notice,
    });
  };

  let lastProgress = 0;
  const progress = (force = false) => {
    if (cfg.onProgress && (force || Date.now() - lastProgress > 150)) {
      lastProgress = Date.now();
      cfg.onProgress(snapshot());
    }
  };

  // Remaining hops already explored from a node, so shared callers/callees aren't expanded twice.
  const explored = new Map<string, number>();

  // Tests that call a method are noted even when tests are kept out of the graph.
  const testCallers = new Map<string, Set<string>>();
  const noteTests = (callee: string, callers: Handle[]) => {
    for (const c of callers) {
      if (isCallable(c.node.kind) && TEST_FILE.test(c.node.uri.path)) {
        (testCallers.get(callee) ?? testCallers.set(callee, new Set()).get(callee)!).add(
          vscode.workspace.asRelativePath(c.node.uri),
        );
      }
    }
  };

  const walk = async (start: Handle, direction: Direction) => {
    const limit = direction === "incoming" ? cfg.callerDepth : cfg.calleeDepth;
    let frontier: Handle[] = [start];
    for (let depth = 0; depth < limit && frontier.length > 0; depth++) {
      const remaining = limit - depth - 1;
      const results = await mapLimit(frontier, HOP_CONCURRENCY, (h) =>
        oneHop(h, direction),
      );
      const next: Handle[] = [];
      frontier.forEach((h, i) => {
        if (direction === "incoming" && cfg.diff) noteTests(h.node.id, results[i]);
        const others = results[i].filter(
          (o) => isCallable(o.node.kind) && isTrackable(o.node.uri),
        );
        if (others.length > MAX_CALLS_PER_SYMBOL) {
          truncated = true;
        }
        for (const o of others.slice(0, MAX_CALLS_PER_SYMBOL)) {
          if (!reg.has(o.node.id)) {
            if (reg.size >= MAX_SYMBOLS) {
              truncated = true;
              continue;
            }
            reg.registerNode(o.node);
          }
          if (direction === "outgoing") {
            addEdge(h.node.id, o.node.id);
          } else {
            addEdge(o.node.id, h.node.id);
          }
          const key = `${direction}:${o.node.id}`;
          if (remaining > 0 && (explored.get(key) ?? -1) < remaining) {
            explored.set(key, remaining);
            next.push(o);
          }
        }
      });
      frontier = next;
      // Stream hop results progressively after each depth level
      progress();
    }
  };

  const expandFrom = async (handle: Handle) => {
    await Promise.all([walk(handle, "incoming"), walk(handle, "outgoing")]);
    progress();
  };

  // Emit the initial root structure immediately (0ms) so the webview renders root nodes without waiting
  progress(true);

  if (cfg.singleRoot) {
    await expandFrom(cfg.singleRoot);
  } else {
    await mapLimit(cfg.candidates, ROOT_CONCURRENCY, async (c) => {
      const handle = await prepareFresh(c.uri, c.symbol.selectionRange.start);
      if (isCallable(c.symbol.kind)) {
        callableAttempts++;
        if (handle) callableResolved++;
      }
      if (!handle) return;
      addRoot(reg.registerNode(handle.node));
      await expandFrom(handle);
    });
  }

  if (callableAttempts >= 3 && callableResolved === 0) {
    notice =
      "The language server returned no call information for these methods, so they are shown without relations. Check that the language's extension is installed and running (e.g. Java: Red Hat Java, C#: C# Dev Kit, C/C++: clangd, Go: gopls, Rust: rust-analyzer, Python: Pylance, PHP: Intelephense, Kotlin: Kotlin).";
  }
  return snapshot();
}

/**
 * Method-to-method call graph. Rooted at every callable in `target.uri`, or at
 * a single method when `target.position` is given. Callers are followed
 * transitively upward and callees downward, up to `maxDepth` hops. Data comes
 * from VSCode's document symbol and call hierarchy providers, so accuracy
 * depends on the active language server.
 */
export async function buildGraph(
  target: GraphTarget,
  options: {
    maxDepth?: number;
    onProgress?: (snapshot: GraphData) => void;
  } = {},
): Promise<GraphData> {
  const settings = readSettings();
  const depth = options.maxDepth ?? settings.maxDepth;
  const uri = target.uri;
  const rootFileId = uri.toString();

  let singleRoot: Handle | undefined;
  let rootLabel = vscode.workspace.asRelativePath(uri);
  let candidates: RootCandidate[] = [];
  let truncated = false;

  if (target.position) {
    const enclosing = symbolAt(await getDocumentSymbols(uri), target.position);
    singleRoot = await prepareFresh(
      uri,
      enclosing?.selectionRange.start ?? target.position,
    );
    if (singleRoot) {
      rootLabel = `${baseName(uri)} › ${singleRoot.node.name}`;
    }
  }
  if (!singleRoot) {
    const symbols = collectCandidates(await getDocumentSymbols(uri), (k) =>
      isCallableKind(k, settings.includeConstructors),
    );
    if (symbols.length > MAX_ROOT_SYMBOLS) {
      truncated = true;
      symbols.length = MAX_ROOT_SYMBOLS;
    }
    candidates = symbols.map((symbol) => ({ uri, symbol }));
  }

  return crawl({
    rootFileId,
    rootFile: uri.fsPath,
    rootLabel,
    singleRoot,
    candidates,
    callerDepth: depth,
    calleeDepth: depth,
    reportedDepth: depth,
    exempt: new Set([rootFileId]),
    truncated,
    onProgress: options.onProgress,
  });
}

/** The declaration of `name` on or just around `line` (0-based), parsed from the text that follows it. */
function callableNear(lines: string[], line: number, name: string, filePath?: string) {
  const mention = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`);
  let lang: string | undefined;
  if (filePath) {
    if (/\.py$/i.test(filePath)) lang = "python";
    else if (/\.go$/i.test(filePath)) lang = "go";
    else if (/\.rs$/i.test(filePath)) lang = "rust";
    else if (/\.java$/i.test(filePath)) lang = "java";
    else if (/\.cs$/i.test(filePath)) lang = "csharp";
    else if (/\.(c|cpp|cc|cxx|h|hpp)$/i.test(filePath)) lang = "cpp";
    else if (/\.php$/i.test(filePath)) lang = "php";
    else if (/\.(kt|kts)$/i.test(filePath)) lang = "kotlin";
    else if (/\.dart$/i.test(filePath)) lang = "dart";
    else if (/\.rb$/i.test(filePath)) lang = "ruby";
    else if (/\.swift$/i.test(filePath)) lang = "swift";
    else if (/\.(scala|sc)$/i.test(filePath)) lang = "scala";
    else if (/\.zig$/i.test(filePath)) lang = "zig";
    else if (/\.lua$/i.test(filePath)) lang = "lua";
  }
  for (let d = 0; d <= 4; d++) {
    for (const i of d === 0 ? [line] : [line - d, line + d]) {
      if (i >= 0 && i < lines.length && mention.test(lines[i])) {
        const text = lines.slice(i, i + 40).join("\n");
        return lang ? parseGenericCallable(text, name, lang) : parseCallable(text, name);
      }
    }
  }
  return undefined;
}

/** Changed files whose symbols are looked up at the same time. */
const DIFF_FILE_CONCURRENCY = 6;
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py|java|cs|c|cpp|cc|cxx|h|hpp|php|kt|kts|dart|rb|swift|scala|sc|zig|lua)$/i;
const SKIPPED_DIRS = /(^|\/)(node_modules|dist|out|build|\.next|vendor|target|\.venv|venv|site-packages|__pycache__|\.gradle|bin\/(?:Debug|Release|x86|x64|AnyCPU)|obj|\.dart_tool|\.build|\.swiftpm|\.metals|\.bloop)\//;

/** The git repository to read changes from: the one containing the file you're looking at, else the first folder. */
export async function diffRepoRoot(hintUri?: vscode.Uri): Promise<string> {
  if (hintUri && hintUri.scheme === "file") {
    try {
      return await repoRootFor(hintUri.fsPath);
    } catch {}
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && active.scheme === "file") {
    try {
      return await repoRootFor(active.fsPath);
    } catch {}
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    try {
      return await repoRootFor(folder.uri.fsPath);
    } catch {}
  }
  throw new Error("Open a folder in a git repository to see its git changes.");
}

/**
 * The methods touched by a git diff ('uncommitted', 'unstaged', 'staged', 'branch' or 'commit:<sha>'), grouped
 * by file, plus their callers and callees. Changes outside any method are listed separately in `diff.other`.
 */
export async function buildDiffGraph(
  source: string,
  options: { onProgress?: (snapshot: GraphData) => void; targetUri?: vscode.Uri } = {},
): Promise<GraphData> {
  const settings = readSettings();
  const root = await diffRepoRoot(options.targetUri);
  const diff = await computeDiff(root, source);

  const candidates: RootCandidate[] = [];
  const changes: DiffInfo["changes"] = {};
  const other: DiffInfo["other"] = [];
  const exempt = new Set<string>();
  const signatures: NonNullable<DiffInfo["signatures"]> = {};
  let approximate = false;

  // Each file's symbols come from the language server, so ask for several at once and merge in diff order.
  const perFile = await mapLimit(diff.files, DIFF_FILE_CONCURRENCY, async (file) => {
    const abs = path.join(root, file.path);
    const uri = vscode.Uri.file(abs);
    const firstLine = Math.max(0, (file.ranges[0]?.start ?? 1) - 1);
    const out = {
      candidates: [] as RootCandidate[],
      changes: {} as DiffInfo["changes"],
      other: [] as DiffInfo["other"],
      exempt: undefined as string | undefined,
      approximate: false,
      signatures: {} as NonNullable<DiffInfo["signatures"]>,
    };
    const skip = (note: string) => {
      out.other.push({ file: abs, label: file.path, note, line: firstLine });
      return out;
    };
    if (!CODE_FILE.test(file.path)) return skip("not a supported source file");
    if (SKIPPED_DIRS.test(file.path)) return skip("in a dependency or build folder");
    if (settings.hideTests && TEST_FILE.test(file.path)) {
      return skip("test file (hidden by codeGraphView.hideTests)");
    }
    if (!file.exact) out.approximate = true;

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return out;
    }
    const symbols = collectCandidates(await getDocumentSymbols(uri), (k) =>
      isCallableKind(k, settings.includeConstructors),
    );
    // Old and new signatures can be compared when the diff has a left ref, hunks and modified status.
    const comparable =
      diff.refs.left !== null && file.hunks && file.exact &&
      file.status === "modified" && CODE_FILE.test(file.path);
    const oldText = comparable ? await readAtRef(root, diff.refs.left!, file.path) : undefined;
    const newText = comparable
      ? diff.refs.right === null
        ? doc.getText()
        : (await readAtRef(root, diff.refs.right, file.path)) ?? doc.getText()
      : undefined;
    const oldLines = oldText?.split("\n");
    const newLines = newText?.split("\n") ?? [];
    const matched = new Set<number>();
    let touched = 0;
    for (const symbol of symbols) {
      const from = symbol.range.start.line + 1;
      const to = symbol.range.end.line + 1;
      let lines = 0;
      let added = 0;
      file.ranges.forEach((r, i) => {
        const lo = Math.max(from, r.start);
        const hi = Math.min(to, r.end);
        if (hi >= lo) {
          lines += hi - lo + 1;
          if (r.pureAdd) added += hi - lo + 1;
          matched.add(i);
        }
      });
      if (lines === 0) continue;
      touched++;
      out.changes[idOf(uri, symbol.selectionRange.start)] = {
        kind:
          file.status === "added" || added >= to - from + 1
            ? "added"
            : "modified",
        lines,
      };
      out.candidates.push({ uri, symbol });
      if (oldLines && file.hunks && out.changes[idOf(uri, symbol.selectionRange.start)].kind === "modified") {
        const at = symbol.selectionRange.start.line;
        const now = callableNear(newLines, at, symbol.name, file.path);
        const before = callableNear(oldLines, mapLineBack(file.hunks, at + 1) - 1, symbol.name, file.path);
        const change = now && before ? compareCallables(before, now) : undefined;
        if (change) out.signatures[idOf(uri, symbol.selectionRange.start)] = change;
      }
    }
    out.exempt = uri.toString();
    const stray = file.ranges.filter((_, i) => !matched.has(i));
    if (stray.length > 0) {
      out.other.push({
        file: abs,
        label: file.path,
        note:
          touched > 0
            ? "also changed outside any method (imports, types, top-level code)"
            : "changed outside any method (imports, types, top-level code)",
        line: Math.max(0, stray[0].start - 1),
      });
    }
    return out;
  });
  for (const r of perFile) {
    candidates.push(...r.candidates);
    Object.assign(changes, r.changes);
    other.push(...r.other);
    if (r.exempt) exempt.add(r.exempt);
    if (r.approximate) approximate = true;
    Object.assign(signatures, r.signatures);
  }
  for (const gone of diff.deleted) {
    other.push({
      file: path.join(root, gone),
      label: gone,
      note: "file deleted",
      line: 0,
    });
  }

  // Methods the change removed that something still calls by name.
  const removed = await findRemoved(root, diff).catch(() => []);
  for (const r of removed) {
    const first = r.refs[0];
    other.push({
      file: path.join(root, first.file),
      label: `removed: ${r.name}`,
      note: `${r.refs.length}${r.refs.length >= 20 ? "+" : ""} possible remaining call${r.refs.length === 1 ? "" : "s"} by name, e.g. ${first.file}:${first.line} (declared in ${r.file})`,
      line: first.line - 1,
    });
  }

  const info: DiffInfo = {
    removed: removed.length,
    source,
    title: diff.title,
    summary: "",
    changes,
    other,
    approximate,
    refs: diff.refs,
    signatures,
    newFiles: diff.files.filter((f) => f.status === "added").map((f) => path.join(root, f.path)),
  };
  const summarize = () => {
    const methods = Object.keys(info.changes).length;
    const fresh = Object.values(info.changes).filter(
      (c) => c.kind === "added",
    ).length;
    const filesTouched = new Set(candidates.map((c) => c.uri.toString())).size;
    info.summary =
      methods === 0
        ? "No changed methods"
        : `${methods} method${methods === 1 ? "" : "s"} changed in ${filesTouched} file${filesTouched === 1 ? "" : "s"}${fresh ? ` (${fresh} new)` : ""}`;
  };
  summarize();

  const data = await crawl({
    rootFileId: `diff:${source}`,
    rootFile: root,
    rootLabel: `Δ ${diff.title}`,
    candidates,
    callerDepth: 3,
    calleeDepth: 1,
    reportedDepth: 3,
    exempt,
    diff: info,
    onProgress: options.onProgress,
  });

  // A changed constant or non-callable value never became a row; report it under "other" instead of dropping it.
  const rowIds = new Set(
    data.files.flatMap((f) => f.symbols.map((sym) => sym.id)),
  );
  for (const c of candidates) {
    const id = idOf(c.uri, c.symbol.selectionRange.start);
    if (info.changes[id] && !rowIds.has(id)) {
      delete info.changes[id];
      other.push({
        file: c.uri.fsPath,
        label: vscode.workspace.asRelativePath(c.uri),
        note: `${c.symbol.name}: changed value, not a function`,
        line: c.symbol.selectionRange.start.line,
      });
    }
  }
  summarize();
  data.diff = info;
  return data;
}
