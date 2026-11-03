// Which outline symbols become method rows: class members that hold functions, methods of object literals, nested
// functions, and one row per method even when the outline and the call hierarchy disagree on its position.
const assert = require('assert');
const path = require('path');
const h = require('./helpers');

const svcText = [];
svcText[12] = '  onClick = () => this.run();';
svcText[14] = '  count = 0;';

function world() {
  return {
    files: {
      '/w/svc.ts': [
        { name: 'Svc', kind: 'Class', line: 0, end: 40, noCh: true, calls: [] },
        { name: 'run', parent: 'Svc', line: 2, end: 10, calls: ['/w/util.ts#fmt'] },
        { name: 'helper', kind: 'Function', parent: 'run', line: 4, end: 6, calls: [] },
        { name: 'map() callback', kind: 'Function', parent: 'run', line: 7, end: 8, calls: [] },
        { name: 'onClick', kind: 'Property', chKind: 'Field', parent: 'Svc', line: 12, end: 13, calls: ['/w/svc.ts#run'] },
        { name: 'count', kind: 'Property', parent: 'Svc', line: 14, end: 15, calls: [] },
        { name: 'api', kind: 'Variable', line: 20, end: 30, calls: [] },
        { name: 'get', parent: 'api', line: 21, end: 23, calls: [] },
        { name: 'post', parent: 'api', line: 24, end: 26, calls: [] },
        { name: 'LIMIT', kind: 'Constant', line: 32, end: 32, resolvesTo: 'svc.ts', calls: [] },
        { name: 'svc.ts', kind: 'Module', chKind: 'File', line: 99, hidden: true, calls: [] },
        { name: 'late', line: 35, end: 38, chCol: 0, calls: ['/w/svc.ts#run'] },
      ],
      '/w/util.ts': [{ name: 'fmt', kind: 'Variable', line: 0, end: 2, calls: [] }],
      '/w/latest_prices.py': [{ name: 'price', kind: 'Function', line: 0, calls: ['/w/svc.ts#run'] }],
    },
    text: { '/w/svc.ts': Array.from({ length: 41 }, (_, i) => svcText[i] || '').join('\n') },
  };
}

async function graph(target) {
  globalThis.__world = world();
  const { buildGraph } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'graphBuilder.ts'), 'lsp.js'));
  const vs = h.freshRequire('./fakes/lsp.js');
  const uri = vs.Uri.file('/w/svc.ts');
  const data = await buildGraph({ uri, position: target && new vs.Position(target.line, target.character) }, { maxDepth: 1 });
  const rows = new Map(data.files.flatMap((f) => f.symbols.map((s) => [s.id, `${path.basename(f.file)}:${s.name}`])));
  return { data, rows, edges: data.edges.map((e) => `${rows.get(e.source)}>${rows.get(e.target)}`).sort() };
}

module.exports = [
  [
    'class fields holding functions, object-literal methods and nested functions are roots; data and callbacks are not',
    async () => {
      const { data, rows } = await graph();
      const roots = data.roots.map((id) => rows.get(id)).sort();
      assert.deepStrictEqual(roots, ['svc.ts:get', 'svc.ts:helper', 'svc.ts:late', 'svc.ts:onClick', 'svc.ts:post', 'svc.ts:run']);
      const names = [...rows.values()];
      for (const gone of ['svc.ts:count', 'svc.ts:map() callback', 'svc.ts:api', 'svc.ts:LIMIT', 'svc.ts:svc.ts', 'svc.ts:Svc']) {
        assert.ok(!names.includes(gone), `${gone} is not a row`);
      }
    },
  ],
  [
    'calls to and from arrow functions and fields are kept, and a file that only looks like a test is not hidden',
    async () => {
      const { edges } = await graph();
      for (const e of ['svc.ts:run>util.ts:fmt', 'svc.ts:onClick>svc.ts:run', 'svc.ts:late>svc.ts:run', 'latest_prices.py:price>svc.ts:run']) {
        assert.ok(edges.includes(e), `${e} in ${edges.join(', ')}`);
      }
    },
  ],
  [
    'a method whose call-hierarchy position differs from its outline position is one row, with its relations',
    async () => {
      const { data, rows } = await graph();
      const late = [...rows].filter(([, n]) => n === 'svc.ts:late');
      assert.strictEqual(late.length, 1, 'one row for late()');
      assert.ok(late[0][0].endsWith('#35:0'), 'under the call-hierarchy id');
      assert.ok(data.roots.includes(late[0][0]), 'and it is the root');
      assert.ok(data.edges.some((e) => e.source === late[0][0]), 'the row carries the edges');
    },
  ],
  [
    'graphing from inside an inline callback roots the graph at the method around it',
    async () => {
      const { data, rows } = await graph({ line: 7, character: 4 });
      assert.strictEqual(rows.get(data.rootSymbolId), 'svc.ts:run');
    },
  ],
];
