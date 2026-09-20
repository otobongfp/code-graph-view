// VS Code keeps only its ~10 newest call-hierarchy lookups alive and silently answers "no calls" for older ones.
// The stand-in in fakes/lsp.js enforces the same rule, so these tests fail if the crawl ever depends on old lookups.
const assert = require('assert');
const path = require('path');
const h = require('./helpers');

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/** A root file with 40 methods plus three helper files; every method calls two others, some across files. */
function makeWorld() {
  const r = rng(7);
  const files = {};
  const names = {};
  for (const [p, n] of [['/w/root.ts', 40], ['/w/a.ts', 8], ['/w/b.ts', 8], ['/w/c.ts', 8]]) {
    files[p] = [];
    names[p] = [];
    for (let i = 0; i < n; i++) {
      files[p].push({ name: 'm' + i, line: i * 5, calls: [] });
      names[p].push('m' + i);
    }
  }
  const allKeys = Object.keys(files).flatMap((p) => names[p].map((nm) => `${p}#${nm}`));
  for (const [p, ms] of Object.entries(files)) {
    for (const m of ms) {
      for (let k = 0; k < 2; k++) {
        const target = allKeys[Math.floor(r() * allKeys.length)];
        if (target !== `${p}#${m.name}` && !m.calls.includes(target)) m.calls.push(target);
      }
    }
  }
  return { files, allKeys };
}

/** Every call edge within `hops` of a root-file method, in both directions. */
function expectedEdges({ files, allKeys }, hops) {
  const out = new Map(allKeys.map((k) => [k, files[k.split('#')[0]].find((m) => m.name === k.split('#')[1]).calls]));
  const inn = new Map(allKeys.map((k) => [k, []]));
  for (const [a, cs] of out) for (const c of cs) inn.get(c).push(a);
  const roots = files['/w/root.ts'].map((m) => `/w/root.ts#${m.name}`);
  const edges = new Set();
  for (const [adj, forward] of [[out, true], [inn, false]]) {
    for (const root of roots) {
      let frontier = [root];
      const seen = new Set([root]);
      for (let d = 0; d < hops; d++) {
        const next = [];
        for (const k of frontier) {
          for (const o of adj.get(k)) {
            edges.add(forward ? `${k}>${o}` : `${o}>${k}`);
            if (!seen.has(o)) {
              seen.add(o);
              next.push(o);
            }
          }
        }
        frontier = next;
      }
    }
  }
  return edges;
}

module.exports = [
  [
    'the fake language server really drops old lookups (looking everything up first loses most calls)',
    async () => {
      const world = makeWorld();
      globalThis.__world = { files: world.files };
      const vs = h.freshRequire('./fakes/lsp.js');
      const uri = vs.Uri.file('/w/root.ts');
      const items = [];
      for (const m of world.files['/w/root.ts']) {
        items.push((await vs.commands.executeCommand('vscode.prepareCallHierarchy', uri, new vs.Position(m.line, 0)))[0]);
      }
      let withCalls = 0;
      for (const it of items) {
        if ((await vs.commands.executeCommand('vscode.provideOutgoingCalls', it)).length) withCalls++;
      }
      assert.ok(withCalls <= 10, `only the newest ~10 lookups may answer, but ${withCalls} did`);
    },
  ],
  [
    'the crawl finds every relation within two hops, with no lookup used after it was dropped',
    async () => {
      const world = makeWorld();
      globalThis.__world = { files: world.files };
      const bundle = h.bundleNode(path.join(h.root, 'src', 'graphBuilder.ts'), 'lsp.js');
      const { buildGraph } = h.freshRequire(bundle);
      const uri = { scheme: 'file', path: '/w/root.ts', fsPath: '/w/root.ts', toString: () => 'file:///w/root.ts' };
      let snapshots = 0;
      const data = await buildGraph({ uri }, { maxDepth: 2, onProgress: () => snapshots++ });

      const keyOf = (id) => {
        const m = /file:\/\/(.*?)#(\d+):/.exec(id);
        return `${m[1]}#${world.files[m[1]].find((x) => x.line === +m[2]).name}`;
      };
      const got = new Set(data.edges.map((e) => `${keyOf(e.source)}>${keyOf(e.target)}`));
      const want = expectedEdges(world, 2);
      assert.deepStrictEqual([...want].filter((e) => !got.has(e)), [], 'no relation may be missing');
      assert.deepStrictEqual([...got].filter((e) => !want.has(e)), [], 'no invented relations');
      assert.strictEqual(data.roots.length, 40, 'every method in the file is a root');
      assert.ok(snapshots >= 1, 'progress snapshots are emitted while the crawl runs');
      assert.strictEqual(data.notice, undefined, 'no "language server has no call hierarchy" notice when it works');
    },
  ],
  [
    'a language server without call hierarchy produces a notice, not a silent empty graph',
    async () => {
      const files = { '/w/root.ts': Array.from({ length: 5 }, (_, i) => ({ name: 'm' + i, line: i * 5, calls: [] })) };
      globalThis.__world = { files };
      globalThis.__noCallHierarchy = true;
      try {
        const bundle = h.bundleNode(path.join(h.root, 'src', 'graphBuilder.ts'), 'lsp.js');
        const { buildGraph } = h.freshRequire(bundle);
        const uri = { scheme: 'file', path: '/w/root.ts', fsPath: '/w/root.ts', toString: () => 'file:///w/root.ts' };
        const data = await buildGraph({ uri }, { maxDepth: 1 });
        assert.strictEqual(data.roots.length, 5, 'the methods are still listed');
        assert.strictEqual(data.edges.length, 0);
        assert.ok(typeof data.notice === 'string' && /call information/.test(data.notice), 'a notice explains the missing relations');
      } finally {
        delete globalThis.__noCallHierarchy;
      }
    },
  ],
];
