const fs = require('fs'); const pathm = require('path');
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b, c, d) { if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } } contains(p) { return (p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character)) && (p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character)); } }
class Uri { constructor(p) { this.scheme = 'file'; this.path = p; this.fsPath = p; } toString() { return 'file://' + this.path; } static file(p) { return new Uri(p); } }
const SymbolKind = { Function: 11, Method: 5, Class: 4, Interface: 10, Module: 1, Namespace: 2, Constructor: 8, 4: 'Class', 5: 'Method', 10: 'Interface', 11: 'Function' };
const WS = globalThis.__ws; const docs = {};
const load = (p) => docs[p] ?? (docs[p] = (() => { const text = fs.readFileSync(p, 'utf8'); const lines = text.split('\n'); const offs = []; let o = 0; for (const l of lines) { offs.push(o); o += l.length + 1; }
  return { languageId: p.endsWith('.ts') ? 'typescript' : 'plaintext', lines, lineCount: lines.length, lineAt: (n) => ({ text: lines[n] }), getText: (r) => { if (!r) return text; const a = offs[r.start.line] + r.start.character; const b = offs[r.end.line] + r.end.character; return text.slice(a, b); },
    offsetAt: (p2) => offs[p2.line] + p2.character, positionAt: (off) => { let l = 0; while (l + 1 < offs.length && offs[l + 1] <= off) l++; return new Position(l, off - offs[l]); } }; })());
function symbols(p) { const d = load(p); const out = []; const L = d.lines;
  for (let i = 0; i < L.length; i++) {
    let m = /^export (interface|class) (\w+)/.exec(L[i]); if (m) { let j = i; while (L[j] !== '}') j++; const cls = { name: m[2], kind: m[1] === 'class' ? SymbolKind.Class : SymbolKind.Interface, range: new Range(i, 0, j, 1), selectionRange: new Range(i, L[i].indexOf(m[2]), i, L[i].indexOf(m[2]) + m[2].length), children: [] };
      if (m[1] === 'class') for (let k = i + 1; k < j; k++) { const mm = /^  (?:public |private )?(?:async )?(\w+)\(/.exec(L[k]); if (mm) { let s = k; while (s > i && (L[s - 1].startsWith('  @') )) s--; let e = k; while (L[e] !== '  }') e++; cls.children.push({ name: mm[1], kind: SymbolKind.Method, range: new Range(s, 0, e, 3), selectionRange: new Range(k, L[k].indexOf(mm[1]), k, L[k].indexOf(mm[1]) + mm[1].length), children: [] }); } }
      out.push(cls); } }
  return out; }
const HOVER = "```typescript\n(method) UserService.create(dto: CreateUserDto, notify?: boolean): Promise<CreateUserDto>\n```\n---\nCreates a user and sends the welcome mail.\n\n*@param* `dto` — the details of the new user  \n*@param* `notify` — whether to send the welcome mail  \n*@returns* the stored user";
const commands = { async executeCommand(cmd, ...a) {
  if (cmd === 'vscode.executeDocumentSymbolProvider') return symbols(a[0].fsPath);
  if (cmd === 'vscode.executeHoverProvider') return [{ contents: [{ value: HOVER }] }];
  if (cmd === 'vscode.executeDefinitionProvider') { const p = pathm.join(WS, 'user.dto.ts'); return [{ uri: Uri.file(p), range: new Range(0, 24, 0, 37) }]; }
  if (cmd === 'vscode.executeWorkspaceSymbolProvider') return [];
  return undefined; } };
const workspace = { workspaceFolders: [{ uri: Uri.file(WS) }], getWorkspaceFolder: () => ({}), asRelativePath: (u) => pathm.relative(WS, u.path), async openTextDocument(u) { return load(u.fsPath); } };
module.exports = { Position, Range, Uri, SymbolKind, commands, workspace, window: {} };
