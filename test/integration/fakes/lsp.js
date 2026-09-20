// Minimal stand-in for the vscode API, with VS Code's real call-hierarchy session eviction (keep newest 10).
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b, c, d) { if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } } contains(p) { return (p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character)) && (p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character)); } }
class Uri { constructor(p) { this.scheme = 'file'; this.path = p; this.fsPath = p; } toString() { return 'file://' + this.path; } static file(p) { return new Uri(p); } }
const SymbolKind = { Function: 11, Method: 5, Constructor: 8, Variable: 12, Constant: 13, Class: 4 };

const world = globalThis.__world;   // { files: {path: [{name, line, calls:[key]}]}, } keys are `${path}#${name}`
const sessions = new Map(); let sessionCounter = 0; let prepares = 0, provides = 0, dead = 0;
globalThis.__stats = () => ({ prepares, provides, dead, live: sessions.size });
const keyOf = (path, name) => `${path}#${name}`;
const find = (key) => { const [path, name] = key.split('#'); const m = world.files[path].find((x) => x.name === name); return { path, m }; };
const mkItem = (key, session) => { const { path, m } = find(key); return { name: m.name, kind: SymbolKind.Method, uri: Uri.file(path), range: new Range(m.line, 0, m.line + 3, 0), selectionRange: new Range(m.line, 2, m.line, 2 + m.name.length), _sessionId: session, _key: key }; };
const callersOf = (key) => Object.entries(world.files).flatMap(([p, ms]) => ms.filter((m) => m.calls.includes(key)).map((m) => keyOf(p, m.name)));

const commands = { async executeCommand(cmd, ...a) {
  if (cmd === 'vscode.executeDocumentSymbolProvider') { const ms = world.files[a[0].path] || []; return ms.map((m) => ({ name: m.name, kind: SymbolKind.Method, detail: '', range: new Range(m.line, 0, m.line + 3, 0), selectionRange: new Range(m.line, 2, m.line, 2 + m.name.length), children: [] })); }
  if (cmd === 'vscode.prepareCallHierarchy') {
    if (globalThis.__noCallHierarchy) return [];   // a language server without call hierarchy
    prepares++; const path = a[0].path; const pos = a[1]; const m = (world.files[path] || []).find((x) => x.line === pos.line); if (!m) return [];
    const id = 's' + (++sessionCounter); sessions.set(id, true);
    for (const k of [...sessions.keys()]) if (sessions.size > 10) sessions.delete(k);   // VS Code: size > 10 -> drop oldest
    return [mkItem(keyOf(path, m.name), id)];
  }
  if (cmd === 'vscode.provideIncomingCalls' || cmd === 'vscode.provideOutgoingCalls') {
    provides++; const item = a[0]; if (!sessions.has(item._sessionId)) { dead++; return []; }   // evicted -> silently empty
    await new Promise((r) => setTimeout(r, 1));
    const keys = cmd === 'vscode.provideOutgoingCalls' ? find(item._key).m.calls : callersOf(item._key);
    return keys.map((k) => cmd === 'vscode.provideOutgoingCalls' ? { to: mkItem(k, item._sessionId), fromRanges: [] } : { from: mkItem(k, item._sessionId), fromRanges: [] });
  }
  return undefined; } };
const workspace = { workspaceFolders: [{ uri: Uri.file('/w') }], getWorkspaceFolder: () => ({}), asRelativePath: (u) => (u.path || String(u)).replace('/w/', ''), getConfiguration: () => ({ get: (k, d) => d }), async openTextDocument(u) { return { lineCount: 100, lineAt: () => ({ text: '' }), getText: () => '' }; } };
module.exports = { Position, Range, Uri, SymbolKind, commands, workspace };
