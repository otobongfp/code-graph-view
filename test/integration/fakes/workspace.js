const fs = require('fs'); const pathm = require('path');
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b, c, d) { this.start = new Position(a, b); this.end = new Position(c, d); } contains(p) { return (p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character)) && (p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character)); } }
class Uri { constructor(p) { this.scheme = 'file'; this.path = p; this.fsPath = p; } toString() { return 'file://' + this.path; } static file(p) { return new Uri(p); } }
const SymbolKind = { Function: 11, Method: 5, Constructor: 8, Variable: 12, Constant: 13, Class: 4 };
const ROOT = globalThis.__root;
function symbolsOf(fsPath) {
  const lines = fs.readFileSync(fsPath, 'utf8').split('\n'); const out = [];
  for (let i = 0; i < lines.length; i++) { const m = /^export (?:async )?function (\w+)\(/.exec(lines[i]); if (!m) continue; let j = i; while (j < lines.length && lines[j] !== '}') j++; const col = lines[i].indexOf(m[1]);
    out.push({ name: m[1], kind: SymbolKind.Function, detail: '', range: new Range(i, 0, j, 1), selectionRange: new Range(i, col, i, col + m[1].length), children: [] }); }
  return out;
}
const commands = { async executeCommand(cmd, ...a) {
  if (cmd === 'vscode.executeDocumentSymbolProvider') return fs.existsSync(a[0].fsPath) ? symbolsOf(a[0].fsPath) : [];
  if (cmd === 'vscode.prepareCallHierarchy') { const s = symbolsOf(a[0].fsPath).find((x) => x.range.contains(a[1])); return s ? [{ name: s.name, kind: s.kind, uri: a[0], range: s.range, selectionRange: s.selectionRange, _sessionId: 's' }] : []; }
  if (cmd === 'vscode.provideIncomingCalls') {   // callers by text: any other function in the repo root whose body mentions `name(`
    const name = a[0].name; const out = [];
    for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.ts'))) {
      const p = pathm.join(ROOT, f); const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (const s of symbolsOf(p)) {
        if (s.name === name) continue;
        if (new RegExp('\\b' + name + '\\s*\\(').test(lines.slice(s.range.start.line + 1, s.range.end.line).join('\n'))) out.push({ from: { name: s.name, kind: s.kind, uri: Uri.file(p), range: s.range, selectionRange: s.selectionRange, _sessionId: 's' }, fromRanges: [] });
      }
    }
    return out; }
  return []; } };
const folder = { uri: Uri.file(ROOT) };
const workspace = { workspaceFolders: [folder], getWorkspaceFolder: () => folder, asRelativePath: (u) => pathm.relative(ROOT, u.path || String(u)), getConfiguration: () => ({ get: (k, d) => d }), async openTextDocument(u) { const file = u && (u.fsPath || u.path || String(u)); return { getText: () => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } } }; } };
module.exports = { Position, Range, Uri, SymbolKind, commands, workspace, window: { activeTextEditor: undefined } };
