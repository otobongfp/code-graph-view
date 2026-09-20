# Development Guide

This document outlines the architecture, development setup, and testing workflow for the **Code Graph View** extension.

---

## 1. Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)
- Visual Studio Code or Cursor

### Initial Setup
```bash
# Clone the repository and install dependencies
git clone https://github.com/your-username/code-graph-view.git
cd code-graph-view
npm install
```

---

## 2. Build and Watch Commands

| Command | Description |
|---|---|
| `npm run compile` | Builds the extension bundle (`out/extension.js`) and webview bundle (`out/webview.js`) using esbuild. |
| `npm run watch` | Runs esbuild in watch mode for fast incremental builds during development. |
| `npm run typecheck` | Type-checks the extension and webview (`tsc --noEmit`). |
| `npm run test:unit` | Fast unit tests for the pure logic (signature parsing, git diff parsing, context compression, secret masking). |
| `npm run test:integration` | Integration tests: real `git` repositories, the crawl against a stand-in language server, and the real webview in a simulated browser. About 20 seconds. |
| `npm test` | Type-check, then unit tests, then integration tests. Run this before committing. |
| `npm run vscode:prepublish` | Compiles production-optimized minified bundles with sourcemaps stripped. |

---

## 3. Running in Extension Development Host

1. Open this repository in **VS Code** or **Cursor**.
2. Run `npm run watch` in an integrated terminal (or use the default build task with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>).
3. Switch to the **Run and Debug** view (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>) and select **Run Extension**.
4. Press <kbd>F5</kbd> to launch a new Extension Development Host window.
5. In the new window, open any codebase and trigger the command **Code Graph: Open Graph for Active File**.

---

## 4. Architecture & Data Flow

```
┌────────────────────────────────────────────────────────┐
│                   VS Code Extension Host                │
│                                                        │
│  src/extension.ts        Entry point & activation      │
│  src/graphBuilder.ts     Call hierarchy walker & cache │
│  src/tsSignature.ts      AST parser for signatures/types│
│  src/git.ts              Git diff & changed lines      │
│  src/contextBucket.ts    Workspace-level state storage │
│  src/contextCompressor.ts Topology tree & markdown gen │
│  src/webviewPanel.ts     Webview manager & IPC bridge  │
└───────────────────────────▲────────────────────────────┘
                            │ (JSON IPC Messages)
┌───────────────────────────▼────────────────────────────┐
│                     Webview (Browser)                  │
│                                                        │
│  webview/main.ts         SVG renderer & interaction   │
│  ELK.js                  Deterministic graph layout    │
│  UI Dock                 Signature & AI Context panels │
└────────────────────────────────────────────────────────┘
```

### Key Modules

- **`src/graphBuilder.ts`**: Walks the VS Code Call Hierarchy API (`vscode.provideIncomingCalls`, `vscode.provideOutgoingCalls`). Because VS Code limits active call-hierarchy lookups, nodes are fetched eagerly and cached as immutable data records.
- **`src/tsSignature.ts`**: Pure AST parser that extracts parameter names, types, default values, decorators, generic type parameters, and return types from source code with hover fallbacks.
- **`src/contextBucket.ts`**: In-memory singleton in the extension host, so the AI context survives closing the graph panel but is cleared when the workspace (window) closes. Stores only lightweight symbol coordinates (`id`, `file`, `line`, `character`, `kind`, `level`, `parentId`); code is fetched fresh when you copy or send, so edits never leave stale copies.
- **`src/contextCompressor.ts`**: Pure engine that builds ASCII call topology trees, resolves diamond dependencies, deduplicates shared interfaces, and applies token budget scaling.
- **`webview/main.ts`**: Single-bundle webview with custom SVG rendering, ELK-driven layout placement, keyboard event routing, and tabbed dock controllers.
- **`webview/styles.css`**: All webview styles, written as a normal stylesheet. esbuild loads it as text (`loader: { '.css': 'text' }` in `esbuild.js`) and `main.ts` injects it in a `<style>` element, so it ships inside the same single bundle. `webview/css.d.ts` tells TypeScript what `import styles from './styles.css'` returns.

---

## 5. Automated Testing

Tests run without VS Code itself. Pure logic is unit-tested directly; everything else is exercised against stand-ins, so a broken build or a regression shows up on your machine before it reaches an editor.

```bash
npm test               # typecheck + unit + integration
npm run test:unit      # the fast layer only
npm run test:integration
```

### Unit tests (`test/*.test.ts`, run by `test/runFeatureTests.js`)

- **`contextCompressor.test.ts`**: backtick escaping, topology trees, shared-callee deduplication, token budgeting, exports of items saved by older versions, and secret masking (including that ordinary code is not touched).
- **`signatureParser.test.ts`**: TypeScript, JavaScript, Python, Go and Rust signatures, decorators, generics, hover parsing, and that a function body never leaks into a return type.
- **`gitDiffParser.test.ts`**: unified diff parsing, hunks, and added/modified/deleted statuses.

### Integration tests (`test/integration/*.test.js`, run by `test/runIntegrationTests.js`)

Each file exports a list of `[name, async function]`; a thrown error fails the test.

- **`crawl`**: VS Code keeps only its ~10 newest call-hierarchy lookups and silently answers "no calls" for older ones. `fakes/lsp.js` enforces the same rule, so this fails if the crawl ever depends on a dropped lookup. It also covers the "language server has no call hierarchy" notice.
- **`git`** and **`diffGraph`**: real `git` repositories in a temp folder; every diff source (uncommitted, unstaged, staged, branch, commit), lines carried onto today's code, and which methods the changes view shows.
- **`signature`**: inputs, output, decorators, doc comment and project types for a NestJS-style method.
- **`contextLifecycle`**: the AI context is kept in memory, is cleared when the workspace reopens, and removes context saved by older versions.
- **`ui.layout`**, **`ui.interactions`**, **`ui.security`**: the real webview bundle in jsdom. Lines never cross cards, cards never overlap, progressive loading, the active-method highlight, the changes view, the signature panel, tooltips, and that hostile text in every message never becomes markup.

`test/integration/helpers.js` holds the shared setup; `test/integration/fakes/` holds the VS Code stand-ins. The UI tests read element ids and classes from the rendered page, so renaming one means updating the matching test.

---

## 6. Contribution Guidelines

1. Ensure code compiles without errors: `npm run compile`.
2. Run and pass all tests: `npm test` (this includes the type-check).
3. Keep AST parsers and context compressor engines pure and free of direct VS Code runtime dependencies so they remain unit-testable.
