const fs = require('fs'); const pathm = require('path');
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b, c, d) { this.start = new Position(a, b); this.end = new Position(c, d); } contains(p) { return (p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character)) && (p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character)); } }
class Uri { constructor(p) { this.scheme = 'file'; this.path = p; this.fsPath = p; } toString() { return 'file://' + this.path; } static file(p) { return new Uri(p); } }
const SymbolKind = { Function: 11, Method: 5, Constructor: 8, Variable: 12, Constant: 13, Class: 4 };
const ROOT = globalThis.__root;
function symbolsOf(fsPath) {
  if (fsPath.endsWith('.py')) return pySymbolsOf(fsPath);
  const lines = fs.readFileSync(fsPath, 'utf8').split('\n'); const out = [];
  for (let i = 0; i < lines.length; i++) { const m = /^export (?:async )?function (\w+)\(/.exec(lines[i]); if (!m) continue; let j = i; while (j < lines.length && lines[j] !== '}') j++; const col = lines[i].indexOf(m[1]);
    out.push({ name: m[1], kind: SymbolKind.Function, detail: '', range: new Range(i, 0, j, 1), selectionRange: new Range(i, col, i, col + m[1].length), children: nestedIn(lines, i + 1, j) }); }
  return out;
}
// Functions declared inside a function (`  function inner() {` ... `  }`), and with __localsAsSymbols its locals, as a server outlines them.
function nestedIn(lines, from, to) {
  const out = [];
  for (let i = from; i < to; i++) {
    const m = /^(\s+)function (\w+)\(/.exec(lines[i]);
    if (m) { let j = i; while (j < to && lines[j] !== m[1] + '}') j++; const col = lines[i].indexOf(m[2]);
      out.push({ name: m[2], kind: SymbolKind.Function, detail: '', range: new Range(i, 0, j, m[1].length + 1), selectionRange: new Range(i, col, i, col + m[2].length), children: nestedIn(lines, i + 1, j) }); i = j; continue; }
    const v = globalThis.__localsAsSymbols && /^\s+const (\w+) =/.exec(lines[i]);
    if (v) { const col = lines[i].indexOf(v[1]); out.push({ name: v[1], kind: SymbolKind.Variable, detail: '', range: new Range(i, col, i, lines[i].length), selectionRange: new Range(i, col, i, col + v[1].length), children: [] }); }
  }
  return out;
}
// Python, outlined the way Pylance does: classes hold their methods, and `__init__` is a plain Method. Like Pylance, a
// call `Widget(3)` is found as a call of the class (by name below), never of `__init__`.
function pySymbolsOf(fsPath) {
  const lines = fs.readFileSync(fsPath, 'utf8').split('\n');
  const block = (from, indent) => { let j = from + 1; while (j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent)) j++; while (j - 1 > from && lines[j - 1].trim() === '') j--; return j - 1; };
  const parse = (from, to, indent) => {
    const out = [];
    for (let i = from; i <= to; i++) {
      const m = /^(\s*)(class|def) (\w+)/.exec(lines[i]);
      if (!m || m[1].length !== indent) continue;
      const end = block(i, indent); const col = lines[i].indexOf(m[3], m[1].length + m[2].length);
      const kind = m[2] === 'class' ? SymbolKind.Class : indent > 0 ? SymbolKind.Method : SymbolKind.Function;
      out.push({ name: m[3], kind, detail: '', range: new Range(i, indent, end, lines[end].length), selectionRange: new Range(i, col, i, col + m[3].length), children: parse(i + 1, end, indent + 4) });
      i = end;
    }
    return out;
  };
  return parse(0, lines.length - 1, 0);
}
const flatten = (ss) => ss.flatMap((s) => [s, ...flatten(s.children)]);
const innermost = (ss, pos) => { for (const s of ss) if (s.range.contains(pos)) return innermost(s.children, pos) ?? s; return undefined; };
const commands = { async executeCommand(cmd, ...a) {
  if (cmd === 'vscode.executeDocumentSymbolProvider') return fs.existsSync(a[0].fsPath) ? symbolsOf(a[0].fsPath) : [];
  if (cmd === 'vscode.prepareCallHierarchy') { const s = innermost(symbolsOf(a[0].fsPath), a[1]); const sel = globalThis.__chAtLineStart && s ? new Range(s.range.start.line, 0, s.range.start.line, 6) : s && s.selectionRange; return s ? [{ name: s.name, kind: s.kind, uri: a[0], range: s.range, selectionRange: sel, _sessionId: 's' }] : []; }   // __chAtLineStart: answer at `export`, not the name
  if (cmd === 'vscode.provideIncomingCalls') {   // callers by text: any other function in the repo root whose body mentions `name(`
    const name = a[0].name; const out = [];
    for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.ts') || x.endsWith('.py'))) {
      const p = pathm.join(ROOT, f); const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (const s of flatten(symbolsOf(p))) {
        if (s.name === name || s.kind === SymbolKind.Variable) continue;
        const own = lines.slice(s.range.start.line + 1, s.range.end.line + (p.endsWith('.py') ? 1 : 0)).filter((_, k) => !s.children.some((c) => c.kind !== SymbolKind.Variable && c.range.start.line <= s.range.start.line + 1 + k && s.range.start.line + 1 + k <= c.range.end.line));
        if (new RegExp('\\b' + name + '\\s*\\(').test(own.join('\n'))) out.push({ from: { name: s.name, kind: s.kind, uri: Uri.file(p), range: s.range, selectionRange: s.selectionRange, _sessionId: 's' }, fromRanges: [] });
      }
    }
    return out; }
  return []; } };
const folder = { uri: Uri.file(ROOT) };
const workspace = { workspaceFolders: [folder], getWorkspaceFolder: () => folder, asRelativePath: (u) => pathm.relative(ROOT, u.path || String(u)), getConfiguration: () => ({ get: (k, d) => d }), async openTextDocument(u) { const file = u && (u.fsPath || u.path || String(u)); return { getText: () => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } } }; } };
module.exports = { Position, Range, Uri, SymbolKind, commands, workspace, window: { activeTextEditor: undefined } };
