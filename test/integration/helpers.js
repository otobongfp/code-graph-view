// Shared helpers for the integration tests: run extension code against a stand-in for the VS Code API,
// and run the real webview bundle in a simulated browser.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cgv-int-'));
process.on('exit', () => fs.rmSync(tmpRoot, { recursive: true, force: true }));

let bundleCount = 0;

/** Bundles a source file for Node, replacing `vscode` with `fake` (a path in ./fakes), and returns the bundle path. */
function bundleNode(entry, fake) {
  const outfile = path.join(tmpRoot, `bundle-${bundleCount++}.js`);
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    outfile,
    alias: fake ? { vscode: path.join(__dirname, 'fakes', fake) } : {},
    logLevel: 'error',
  });
  return outfile;
}

/** A newly loaded copy of a module, so module-level state (singletons, caches) starts empty. */
function freshRequire(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}

function tempDir(name) {
  const dir = path.join(tmpRoot, `${name}-${bundleCount++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A throwaway git repository with a helper to run commands and write files inside it. */
function gitRepo(name) {
  const dir = tempDir(name);
  const sh = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' }).toString();
  sh('git init -q -b main');
  sh('git config user.email test@example.com');
  sh('git config user.name Test');
  return { dir, sh, write: (file, text) => fs.writeFileSync(path.join(dir, file), text) };
}

/** A small TS function, one per call, so tests read like the code they describe. */
const fn = (name, body = 'return 1;') => `export function ${name}() {\n  ${body}\n}\n`;

// ---------------------------------------------------------------------------------------------------------------
// The webview
// ---------------------------------------------------------------------------------------------------------------

let webviewCode;
function webviewSource() {
  if (!webviewCode) {
    const result = esbuild.buildSync({
      entryPoints: [path.join(root, 'webview', 'main.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      loader: { '.css': 'text' },
      logLevel: 'error',
    });
    const code = result.outputFiles[0].text;
    const call = 'await elk.layout(elkGraph)';
    if (!code.includes(call)) {
      throw new Error(`webview no longer contains "${call}"; update helpers.js`);
    }
    // ELK is handed plain JSON from this realm; jsdom's separate realm otherwise trips its importer.
    webviewCode = code.replace(call, 'JSON.parse(await window.__elkLayout(JSON.stringify(elkGraph)))');
  }
  return webviewCode;
}

let currentErrors = [];
process.on('unhandledRejection', (e) => currentErrors.push(`unhandled rejection: ${(e && e.stack) || e}`));

/** Loads the webview into a simulated browser. `send` delivers a message from the extension, `posted` collects what it sends back. */
function createWebview() {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const ELK = require('elkjs/lib/elk.bundled.js');
  const errors = (currentErrors = []);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(`page error: ${e.message}`));
  const dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const w = dom.window;
  const posted = [];
  // Messages are copied out of the page's own realm so tests can compare them strictly.
  w.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))), getState: () => undefined, setState: () => {} });
  w.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  w.__elkLayout = async (json) => JSON.stringify(await new ELK().layout(JSON.parse(json)));
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get: () => 1200 });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get: () => 800 });
  w.Element.prototype.scrollIntoView = function () {};
  w.eval(webviewSource());

  return {
    w,
    posted,
    errors,
    send: (message) => w.dispatchEvent(new w.MessageEvent('message', { data: message })),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    click: (el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    $: (selector) => w.document.querySelector(selector),
    $$: (selector) => [...w.document.querySelectorAll(selector)],
    lastPosted: (command) => posted.filter((m) => m.command === command).pop(),
    close: () => w.close(),
  };
}

const sym = (id, name, line, kind = 'method') => ({ id, name, kind, line, character: 0 });

/** A small valid graph: three methods in a.ts calling into b.ts. */
function sampleGraph(extra = {}) {
  return {
    rootFile: '/w/a.ts',
    rootFileId: 'file:///w/a.ts',
    rootLabel: 'a.ts',
    roots: ['a1', 'a2', 'a3'],
    maxDepth: 2,
    truncated: false,
    fetchMs: 5,
    files: [
      { id: 'file:///w/a.ts', label: 'src/a.ts', file: '/w/a.ts', symbols: [sym('a1', 'sendEmail', 1), sym('a2', 'saveUser', 5), sym('a3', 'audit', 9)] },
      { id: 'file:///w/b.ts', label: 'src/b.ts', file: '/w/b.ts', symbols: [sym('b1', 'load', 1), sym('b2', 'save', 5)] },
    ],
    edges: [
      { id: 'a1>b1', source: 'a1', target: 'b1' },
      { id: 'a2>b2', source: 'a2', target: 'b2' },
      { id: 'a1>b2', source: 'a1', target: 'b2' },
    ],
    ...extra,
  };
}

const graphMessage = (data, extra = {}) => ({ command: 'graphData', data, trail: [data.rootLabel], cursor: 0, ...extra });

module.exports = { root, bundleNode, freshRequire, tempDir, gitRepo, fn, createWebview, sampleGraph, graphMessage, sym };
