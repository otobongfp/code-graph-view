# Changelog

All notable changes to Code Graph View are recorded here.

## [0.2.1]

### Fixed
- **Methods missing from classes**: the outline is now searched more thoroughly, so these show up as methods:
  - arrow-function class fields (`onClick = () => {}`) and getters/setters; data fields like `count = 0` are still left out
  - methods of object literals and class expressions held in a variable (`const api = { get() {} }`, `const Foo = class {}`)
  - named functions declared inside a method (inline callbacks such as `map() callback` stay part of their method)
- **Missing calls to arrow functions**: callers and callees that the language server reports as variables, fields or properties (`const fmt = () => ...`, `onClick = () => ...`) are no longer dropped from the graph.
- **Duplicate rows with no relations**: when the outline and the call hierarchy give a method slightly different positions (e.g. the `async` keyword rather than the name), the method is now one row that carries all its calls, instead of an empty row next to a second one with the edges.
- **Changes view**: changes, signature changes and tested-by information now stay on the same row as the method's callers when those positions differ, and a changed arrow function is no longer reported as "changed value, not a function".
- **Constants shown as functions**: a variable or constant that isn't a function is no longer added as a row when the language server answers with the file or block around it.
- **Graphing from inside a callback**: running *Show Graph* with the cursor inside an inline callback now roots the graph at the method around it, not at the anonymous callback.
- **Ordinary files hidden as tests**: test detection now looks at the file name only and matches `Test`/`Spec` suffixes case-sensitively, so files like `latest_prices.py`, `LatestPrice.java`, `Contest.cs`, `Latest.swift` or anything under a `testing/` folder are no longer hidden by `codeGraphView.hideTests`. Maven/Gradle `src/test/` trees are still treated as tests.
- **Dependency folders**: the call graph, the changes view and symbol search now share one list of dependency and build folders (`dist`, `out` and `.next` were previously only skipped in the changes view), and the folders are matched inside the workspace only, so a project checked out under a folder named `build` or `target` is no longer hidden.
- When many roots exceed the per-file limit, functions and methods are kept ahead of variables and fields that may not be functions.
- Symbol search lists constructors too.

## [0.2.0]

### Added
- **Interactive Type Unfolding**: Parameter and return types referencing project schemas now display an inline unfold button `[TypeName ▾]` to inspect interface, struct, and type definitions directly within the parameter row.
- **Token Syntax Highlighting for Types**: Color-coded keywords, primitives, container wrappers (`Promise`, `Result`, `Option`, `Stream`, `Task`), and operators (`|`, `&`, `=>`, `->`) in signature inspector types.
- **Return Type Drill-down**: Automatically deconstructs async/container effect types (e.g. `Promise<Result<User[], ApiError>>`) to display unwrapped payloads and error paths separately.
- **Query vs. Command Classification**: Classifies functions into pure/read-only queries vs state-mutating commands with VS Code Codicon vector icons and theme colors.
- **Fine-Grained Parameter Flags**: Added visual badges for parameter mutability (`mut`), nullability (`nullable`), immutability (`readonly`), and optionality (`opt`).
- **Rich Signature Diff Breakdown**: Detailed reason lists in git diffs and hover tooltips for breaking changes vs compatible extensions.
- **Streamlined Documentation**: Cleaned up horizontal rule dividers across README.md for a sleek presentation.

## [0.1.2]

### Added
- When a language has no language server answering (no call hierarchy, or no symbols at all in a file with code), the notice now names the language and offers a "Find <Language> Extensions" button that opens the Extensions view with a marketplace search that works on both the VS Code Marketplace and Open VSX.

### Fixed
- Fixed PNG export and copy silently falling back to SVG: the standalone SVG packager emitted duplicate `transform` attributes and duplicate `<defs>` IDs, which violated XML well-formedness rules and caused the browser image decoder to fail during rasterization.
- Reconciled CSS transforms and attributes in `packageStandaloneSvg` so all elements emit standard SVG XML attributes without duplicates.
- Resolved all `var(--vscode-*)` and `var(--*)` CSS custom properties to concrete color values with automatic light/dark theme adaptation.
- Fixed clipboard PNG copying by passing a Promise directly to `ClipboardItem` to preserve user activation gesture in Chromium, and providing clear status bar feedback if clipboard permissions are restricted in the webview.
- Dropped the redundant "(2x)" suffix from the "Save PNG Image" menu label.

## [0.1.1]

### Fixed
- Fixed SVG standalone export framing and viewBox alignment by normalizing runtime pan/zoom canvas transforms.
- Fixed PNG image export and clipboard copy by adding image permissions (`data:`, `blob:`) to the webview Content Security Policy.
- Improved Mermaid flowchart generator with clean `flowchart TD` hierarchy, concise node IDs, proper label escaping, and gold root-method highlighting.

## [0.1.0]

### Added
- Export diagram toolbar action with support for three formats:
  - **Mermaid Markdown (`.mmd` / ````mermaid`)**: Generates clean GitHub-compatible flowcharts with file subgraphs and caller-to-callee directional links.
  - **Standalone Scalable Vector Graphics (`.svg`)**: Vector-accurate SVG with inlined styles, fonts, and arrowhead markers for use in documentation, RFCs, and image editors.
  - **High-Resolution PNG (`.png`)**: 2x Retina canvas rendering with options to save directly to disk or copy to the system clipboard.
- Services Mode Mermaid export with aggregated call counts on connecting edges.

## [0.0.4]

### Added
- Expanded multi-language support from 4 to 15 languages: added **Java**, **C#**, **C / C++**, **PHP**, **Kotlin**, **Dart / Flutter**, **Ruby**, **Swift**, **Scala**, **Zig**, and **Lua** alongside TypeScript/JavaScript, Go, Rust, and Python.
- Multi-language signature and type parsing for all 15 supported languages for callables and working-tree diffs.
- Test detection and build/dependency filtering for `.gradle`, `build`, `bin`, `obj`, `.dart_tool`, `.build`, `.swiftpm`, `.metals`, and `.bloop` directories.
- Editor title menu button and command support across all 15 language identifiers.

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
