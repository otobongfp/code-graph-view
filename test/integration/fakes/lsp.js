// Minimal stand-in for the vscode API, with VS Code's real call-hierarchy session eviction (keep newest 10).
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b, c, d) { if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } } contains(p) { return (p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character)) && (p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character)); } }
class Uri { constructor(p) { this.scheme = 'file'; this.path = p; this.fsPath = p; } toString() { return 'file://' + this.path; } static file(p) { return new Uri(p); } }
const SymbolKind = { File: 0, Module: 1, Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Function: 11, Variable: 12, Constant: 13 };

// { files: {path: [{name, line, calls:[key]}]}, text?: {path: source} } keys are `${path}#${name}`. Optional per method:
// kind / chKind (SymbolKind names for the outline and the call hierarchy), end (last line), parent (enclosing name),
// chCol (column the call hierarchy reports, to differ from the outline's 2), noCh (no call-hierarchy item),
// resolvesTo (name answered instead, like a server resolving a constant to its file), hidden (not in the outline).
const world = globalThis.__world;
const sessions = new Map(); let sessionCounter = 0; let prepares = 0, provides = 0, dead = 0;
globalThis.__stats = () => ({ prepares, provides, dead, live: sessions.size });
const keyOf = (path, name) => `${path}#${name}`;
const find = (key) => { const [path, name] = key.split('#'); const m = world.files[path].find((x) => x.name === name); return { path, m }; };
const mkItem = (key, session) => { const { path, m } = find(key); const col = m.chCol ?? 2; return { name: m.name, kind: SymbolKind[m.chKind || m.kind || 'Method'], uri: Uri.file(path), range: new Range(m.line, 0, m.end ?? m.line + 3, 0), selectionRange: new Range(m.line, col, m.line, col + m.name.length), _sessionId: session, _key: key }; };
const outline = (path) => {
  const ms = (world.files[path] || []).filter((m) => !m.hidden); const byName = new Map(); const top = [];
  for (const m of ms) byName.set(m.name, { name: m.name, kind: SymbolKind[m.kind || 'Method'], detail: '', range: new Range(m.line, 0, m.end ?? m.line + 3, 0), selectionRange: new Range(m.line, 2, m.line, 2 + m.name.length), children: [] });
  for (const m of ms) (m.parent ? byName.get(m.parent).children : top).push(byName.get(m.name));
  return top;
};
const callersOf = (key) => Object.entries(world.files).flatMap(([p, ms]) => ms.filter((m) => m.calls.includes(key)).map((m) => keyOf(p, m.name)));

const commands = { async executeCommand(cmd, ...a) {
  if (cmd === 'vscode.executeDocumentSymbolProvider') return outline(a[0].path);
  if (cmd === 'vscode.prepareCallHierarchy') {
    if (globalThis.__noCallHierarchy) return [];   // a language server without call hierarchy
    prepares++; const path = a[0].path; const pos = a[1]; const m = (world.files[path] || []).find((x) => x.line === pos.line); if (!m || m.noCh) return [];
    const id = 's' + (++sessionCounter); sessions.set(id, true);
    for (const k of [...sessions.keys()]) if (sessions.size > 10) sessions.delete(k);   // VS Code: size > 10 -> drop oldest
    return [mkItem(keyOf(path, m.resolvesTo || m.name), id)];
  }
  if (cmd === 'vscode.provideIncomingCalls' || cmd === 'vscode.provideOutgoingCalls') {
    provides++; const item = a[0]; if (!sessions.has(item._sessionId)) { dead++; return []; }   // evicted -> silently empty
    await new Promise((r) => setTimeout(r, 1));
    const keys = cmd === 'vscode.provideOutgoingCalls' ? find(item._key).m.calls : callersOf(item._key);
    return keys.map((k) => cmd === 'vscode.provideOutgoingCalls' ? { to: mkItem(k, item._sessionId), fromRanges: [] } : { from: mkItem(k, item._sessionId), fromRanges: [] });
  }
  return undefined; } };
const workspace = { workspaceFolders: [{ uri: Uri.file('/w') }], getWorkspaceFolder: () => ({}), asRelativePath: (u) => (u.path || String(u)).replace('/w/', ''), getConfiguration: () => ({ get: (k, d) => d }), async openTextDocument(u) { const lines = ((world.text || {})[u.path] || '').split('\n'); return { lineCount: lines.length, lineAt: (i) => ({ text: lines[i] || '' }), getText: (r) => (r ? lines.slice(r.start.line, r.end.line + 1) : lines).join('\n') }; } };
module.exports = { Position, Range, Uri, SymbolKind, commands, workspace };
