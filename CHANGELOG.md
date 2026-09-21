# Changelog

All notable changes to Code Graph View are recorded here.

## [0.0.2]

### Fixed
- Breadcrumbs and Back/Forward (including Alt+←/→) now step through the methods you click before moving between roots, and Forward replays them.
- Clicking the current root's crumb clears the clicked-method steps instead of doing nothing.
- Earlier roots stay visible beside the method steps, and the crumb window follows your position instead of always showing the last few.
- Returning to a root restores its method steps, expanded cards and depth, along with its pan and zoom.

### Documentation
- README shows how to open the extension from the activity bar.

## [0.0.1]

### Added
- Interactive call graph: files as cards, methods as rows, calls as lines, built from the language server's call hierarchy (TypeScript/JavaScript, Go, Rust, Python).
- Trace a method's callers and callees with a Hops slider; keyboard navigation; double-click to re-root; back/forward and a breadcrumb trail.
- Search for files and symbols.
- Changes view: show only the methods touched by uncommitted, staged or unstaged edits, the current branch, or any recent commit, with optional callers to show impact.
- Signature panel: inputs, output, decorators, doc comments and the project types a method uses.
- AI Context: curate methods and paths, choose a detail level for each, fit a token budget, and copy or send to chat. Credentials are masked in exports (setting: `codeGraphView.redactSecrets`).
- Services view: one box per file with call counts between them.
- Settings: `codeGraphView.maxDepth`, `codeGraphView.hideTests`, `codeGraphView.includeConstructors`, `codeGraphView.redactSecrets`.

### Notes
- The AI Context is kept in memory and is cleared when the workspace closes.
- The extension is disabled in untrusted workspaces and does not support virtual workspaces, because it runs `git` in the workspace.
