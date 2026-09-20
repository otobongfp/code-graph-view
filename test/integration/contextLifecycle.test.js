// The AI context belongs to the open workspace: it survives closing the graph panel, and is gone when the workspace closes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const KEY = 'codeGraphView.contextBucket';
const item = (id) => ({ id, file: `/w/${id}.ts`, name: id, line: 1, character: 0, kind: 'method', level: 'signature' });

function bundle() {
  const entry = path.join(h.tempDir('entry'), 'entry.ts');
  fs.writeFileSync(
    entry,
    `export { activate } from ${JSON.stringify(path.join(h.root, 'src', 'extension'))};\n` +
      `export { ContextBucketManager } from ${JSON.stringify(path.join(h.root, 'src', 'contextBucket'))};\n`
  );
  return h.bundleNode(entry, 'plain.js');
}

/** Opens a workspace: a fresh copy of the extension, whose storage already holds `saved`. */
function openWorkspace(file, saved) {
  const { activate, ContextBucketManager } = h.freshRequire(file);
  const store = new Map(Object.entries(saved));
  const writes = [];
  activate({
    subscriptions: [],
    extensionUri: {},
    workspaceState: {
      get: (k, d) => (store.has(k) ? store.get(k) : d),
      update: (k, v) => {
        writes.push([k, v === undefined ? 'deleted' : 'written']);
        v === undefined ? store.delete(k) : store.set(k, v);
        return Promise.resolve();
      },
    },
  });
  return { bucket: ContextBucketManager.get(), store, writes };
}

// Summaries need a real language server; the items are stored before that step, so its failure is irrelevant here.
const add = async (bucket, ...ids) => bucket.addItems(ids.map(item)).catch(() => undefined);

module.exports = [
  [
    'nothing is written to workspace storage, so nothing can outlive the workspace',
    async () => {
      const file = bundle();
      const ws = openWorkspace(file, {});
      await add(ws.bucket, 'create', 'save');
      assert.deepStrictEqual(ws.bucket.getItems().map((i) => i.name), ['create', 'save']);
      assert.deepStrictEqual(ws.bucket.getItems().map((i) => i.kind), ['method', 'method'], 'each stored item keeps its kind');
      assert.strictEqual(ws.store.size, 0);
      await ws.bucket.removeItem('save');
      assert.deepStrictEqual(ws.bucket.getItems().map((i) => i.name), ['create']);
    },
  ],
  [
    'reopening the workspace starts empty and deletes context saved by an older version',
    async () => {
      const file = bundle();
      const ws = openWorkspace(file, { [KEY]: [item('stale1'), item('stale2')] });
      assert.strictEqual(ws.bucket.getItems().length, 0);
      assert.ok(!ws.store.has(KEY), 'the leftover saved context is removed');
      assert.deepStrictEqual(ws.writes, [[KEY, 'deleted']]);
    },
  ],
  [
    'the context survives inside one window, and Clear empties it',
    async () => {
      const file = bundle();
      const ws = openWorkspace(file, {});
      await add(ws.bucket, 'x');
      // Closing and reopening the graph panel does not touch the extension's memory.
      assert.deepStrictEqual(require(file).ContextBucketManager.get().getItems().map((i) => i.name), ['x']);
      await ws.bucket.clear().catch(() => undefined);
      assert.strictEqual(ws.bucket.getItems().length, 0);
    },
  ],
];
