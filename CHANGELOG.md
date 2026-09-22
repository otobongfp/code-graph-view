# Changelog

All notable changes to Code Graph View are recorded here.

## [0.0.3]

### Added
- Review strip in the changes view: changed methods, callers not updated, signature changes, methods with no test found, and removed methods still referenced. Risk bars on methods, a ⚠ risky filter, and a stepper that walks the changes riskiest first.
- Clicking a changed method opens VS Code's before/after diff at that method.
- Signature-change detection for TypeScript/JavaScript (working-tree diffs), marking each as breaking or compatible.
- Removed methods that something still calls by name are listed under "Other changes".
- *Code Graph: Review a Pull Request* command; changes can also be compared with a named base (`branch:<ref>`).

### Changed
- Changed files are analysed in parallel, and staged/commit line numbers are mapped with one git call instead of one per file.
- A cold language server no longer leaves the changes view empty: it retries once.
- Skipped files in the changes view say why ("in a dependency or build folder" or "not a supported source file").

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
