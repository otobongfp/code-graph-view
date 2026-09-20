class EventEmitter { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} }
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b, c, d) { this.start = new Position(a, b); this.end = new Position(c, d); } }
class Uri { static file(p) { return { scheme: 'file', path: p, fsPath: p, toString: () => 'file://' + p }; } }
const SymbolKind = { Function: 11, Method: 5, Constructor: 8, Variable: 12, Constant: 13, Class: 4, Interface: 10, Module: 1, Namespace: 2 };
module.exports = {
  EventEmitter, Position, Range, Uri, SymbolKind, ViewColumn: { One: 1, Beside: -2 }, TextEditorRevealType: { InCenter: 2 }, Selection: class {},
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => undefined, getCommands: async () => [] },
  workspace: { workspaceFolders: [], onDidSaveTextDocument: () => ({ dispose() {} }), getConfiguration: () => ({ get: (k, d) => d }), asRelativePath: (u) => String(u.path || u), getWorkspaceFolder: () => undefined, createFileSystemWatcher: () => ({ onDidCreate() {}, onDidDelete() {}, dispose() {} }) },
  window: { showInformationMessage: async () => undefined, activeTextEditor: undefined }, env: { clipboard: { writeText: async () => {} } },
};
