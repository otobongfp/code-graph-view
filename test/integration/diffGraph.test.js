// The changes view end to end: git says which lines changed, the (stand-in) language server says which methods those
// lines belong to, and the graph shows exactly those methods.
const assert = require('assert');
const path = require('path');
const h = require('./helpers');

function scenario() {
  const repo = h.gitRepo('diff');
  const fn = h.fn;
  repo.write('a.ts', ['one', 'two', 'three'].map((n) => fn(n)).join('\n'));
  repo.write('b.ts', fn('load') + '\n' + fn('save'));
  repo.write('notes.md', '# n\n');
  repo.write('a.spec.ts', fn('t1'));
  repo.sh('git add -A && git commit -q -m first');
  repo.write('a.ts', ['one', 'two', 'three'].map((n) => (n === 'two' ? fn(n, 'return 22;') : fn(n))).join('\n') + '\n' + fn('four'));
  repo.sh('git commit -q -am second');
  const sha = repo.sh('git rev-parse --short HEAD').trim();
  repo.write('a.ts', '// header\n// more\n' + require('fs').readFileSync(path.join(repo.dir, 'a.ts'), 'utf8'));
  repo.write('b.ts', fn('load', 'return 100;') + '\n' + fn('save'));
  repo.sh('git add b.ts');
  repo.write('a.spec.ts', fn('t1', 'return 9;'));
  repo.write('c.ts', fn('brandNew'));
  repo.write('notes.md', '# changed\n');
  return { repo, sha };
}

async function changed(repo, source) {
  globalThis.__root = repo.dir;
  const { buildDiffGraph } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'graphBuilder.ts'), 'workspace.js'));
  const data = await buildDiffGraph(source);
  const nameOf = (id) => {
    for (const f of data.files) for (const s of f.symbols) if (s.id === id) return `${path.basename(f.file)}:${s.name}`;
    return id;
  };
  return {
    data,
    methods: Object.fromEntries(Object.entries(data.diff.changes).map(([id, c]) => [nameOf(id), c.kind])),
    other: data.diff.other.map((o) => o.label).sort(),
  };
}

module.exports = [
  [
    "a Python __init__ is called through its class, so a changed constructor still has its untouched callers",
    async () => {
      const repo = h.gitRepo('diff-py-init');
      repo.write('lib.py', 'class Widget:\n    def __init__(self, size):\n        self.size = size\n\n    def grow(self):\n        return self.size + 1\n');
      repo.write('use.py', 'def make():\n    return Widget(3)\n');
      repo.sh('git add -A && git commit -q -m first');
      repo.write('lib.py', 'class Widget:\n    def __init__(self, size, colour):\n        self.size = size\n\n    def grow(self):\n        return self.size + 1\n');
      const r = await changed(repo, 'uncommitted');
      assert.deepStrictEqual(r.methods, { 'lib.py:__init__': 'modified' });
      const id = Object.keys(r.data.diff.changes)[0];
      assert.strictEqual(r.data.diff.signatures[id].change, 'breaking');
      const { reviewDiff } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'diffReview.ts')));
      const review = reviewDiff(r.data).byId.get(id);
      assert.strictEqual(review.callers, 1, 'make() builds a Widget');
      assert.strictEqual(review.notUpdated, 1, 'and did not change');
      assert.strictEqual(review.level, 'high', 'breaking signature with an untouched caller');
    },
  ],
  [
    'a changed nested function is a changed method, so it is not counted as an untouched caller',
    async () => {
      const repo = h.gitRepo('diff-nested');
      repo.write('lib.ts', 'export function helper(x: number) {\n  return x;\n}\n');
      repo.write('app.ts', 'export function handler() {\n  function inner() {\n    return helper(1);\n  }\n  return inner();\n}\n');
      repo.sh('git add -A && git commit -q -m first');
      repo.write('lib.ts', 'export function helper(x: number) {\n  return x + 1;\n}\n');
      repo.write('app.ts', 'export function handler() {\n  function inner() {\n    const total = helper(2);\n    return total;\n  }\n  return inner();\n}\n');
      globalThis.__localsAsSymbols = true;
      try {
        const r = await changed(repo, 'uncommitted');
        assert.deepStrictEqual(r.methods, { 'app.ts:handler': 'modified', 'app.ts:inner': 'modified', 'lib.ts:helper': 'modified' });
        assert.ok(!r.data.diff.other.some((o) => /changed value/.test(o.note)), 'a local inside a changed function is not reported as a changed value');
        const helperId = Object.keys(r.data.diff.changes).find((id) => id.includes('lib.ts'));
        const { reviewDiff } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'diffReview.ts')));
        const review = reviewDiff(r.data).byId.get(helperId);
        assert.strictEqual(review.callers, 1, 'inner() calls it');
        assert.strictEqual(review.notUpdated, 0, 'and inner() changed in this diff');
      } finally {
        delete globalThis.__localsAsSymbols;
      }
    },
  ],
  [
    'an unchanged nested function inside a changed function is still an untouched caller',
    async () => {
      const repo = h.gitRepo('diff-nested2');
      repo.write('lib.ts', 'export function helper(x: number) {\n  return x;\n}\n');
      repo.write('app.ts', 'export function handler() {\n  function inner() {\n    return helper(1);\n  }\n  return inner();\n}\n');
      repo.sh('git add -A && git commit -q -m first');
      repo.write('lib.ts', 'export function helper(x: number) {\n  return x + 1;\n}\n');
      repo.write('app.ts', 'export function handler() {\n  function inner() {\n    return helper(1);\n  }\n  return inner() + 1;\n}\n');
      const r = await changed(repo, 'uncommitted');
      assert.deepStrictEqual(r.methods, { 'app.ts:handler': 'modified', 'lib.ts:helper': 'modified' });
      const helperId = Object.keys(r.data.diff.changes).find((id) => id.includes('lib.ts'));
      const { reviewDiff } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'diffReview.ts')));
      assert.strictEqual(reviewDiff(r.data).byId.get(helperId).notUpdated, 1, 'inner() calls it and did not change');
    },
  ],
  [
    'a changed signature, its untouched caller and the test that reaches it are all picked up',
    async () => {
      const repo = h.gitRepo('review-sig');
      repo.write('lib.ts', 'export function load(id: string) {\n  return id;\n}\n');
      repo.write('use.ts', 'export function run() {\n  return load("y");\n}\n');
      repo.write('lib.test.ts', 'export function testLoad() {\n  return load("x");\n}\n');
      repo.sh('git add -A && git commit -q -m first');
      repo.write('lib.ts', 'export function load(id: number, extra: string) {\n  return id;\n}\n');
      const r = await changed(repo, 'uncommitted');
      const id = Object.keys(r.data.diff.changes)[0];
      assert.deepStrictEqual(r.methods, { 'lib.ts:load': 'modified' });
      assert.strictEqual(r.data.diff.signatures[id].change, 'breaking');
      assert.strictEqual(r.data.diff.signatures[id].before, '(id: string)');
      assert.strictEqual(r.data.diff.signatures[id].after, '(id: number, extra: string)');
      assert.deepStrictEqual(r.data.diff.testedBy[id], ['lib.test.ts'], 'found although tests are hidden from the graph');
      assert.ok(!r.data.files.some((f) => f.file.endsWith('lib.test.ts')), 'and still not drawn');

      const { reviewDiff } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'diffReview.ts')));
      const review = reviewDiff(r.data).byId.get(id);
      assert.strictEqual(review.notUpdated, 1, 'run() calls it and did not change');
      assert.strictEqual(review.tests, 1);
      assert.strictEqual(review.level, 'high', 'breaking signature with an untouched caller');
    },
  ],
  [
    'a body-only change is not a signature change, and a new optional parameter is compatible',
    async () => {
      const repo = h.gitRepo('review-sig2');
      repo.write('a.ts', 'export function f(a: string) {\n  return a;\n}\nexport function g(a: string) {\n  return a;\n}\n');
      repo.sh('git add -A && git commit -q -m first');
      repo.write('a.ts', 'export function f(a: string) {\n  return a + "!";\n}\nexport function g(a: string, b?: number) {\n  return a;\n}\n');
      const r = await changed(repo, 'uncommitted');
      const [gId] = Object.keys(r.data.diff.signatures);
      assert.deepStrictEqual(Object.values(r.data.diff.signatures).map((s) => s.change), ['compatible'], 'only g() changed its signature');
      assert.strictEqual(r.data.files.flatMap((f) => f.symbols).find((x) => x.id === gId).name, 'g');
      assert.strictEqual(Object.keys(r.data.diff.changes).length, 2, 'both methods changed');
    },
  ],
  [
    'uncommitted: the modified and the new method; everything else is listed as "other"',
    async () => {
      const { repo } = scenario();
      const r = await changed(repo, 'uncommitted');
      assert.deepStrictEqual(r.methods, { 'b.ts:load': 'modified', 'c.ts:brandNew': 'added' });
      assert.deepStrictEqual(r.other, ['a.spec.ts', 'a.ts', 'notes.md'], 'header comment, test file and markdown are not methods');
      assert.strictEqual(r.data.roots.length, 2);
      assert.match(r.data.diff.summary, /2 methods changed in 2 files \(1 new\)/);
    },
  ],
  [
    'unstaged and staged are separate',
    async () => {
      const { repo } = scenario();
      assert.deepStrictEqual((await changed(repo, 'unstaged')).methods, { 'c.ts:brandNew': 'added' });
      assert.deepStrictEqual((await changed(repo, 'staged')).methods, { 'b.ts:load': 'modified' });
    },
  ],
  [
    'a commit is mapped through the lines that have shifted since (two() modified, four() new)',
    async () => {
      const { repo, sha } = scenario();
      const r = await changed(repo, `commit:${sha}`);
      assert.deepStrictEqual(r.methods, { 'a.ts:two': 'modified', 'a.ts:four': 'added' });
      assert.strictEqual(r.data.diff.approximate, false);
    },
  ],
  [
    'branch on a repository with no other branch compares with the previous commit',
    async () => {
      const { repo } = scenario();
      const r = await changed(repo, 'branch');
      assert.deepStrictEqual(r.methods, { 'a.ts:two': 'modified', 'a.ts:four': 'added', 'b.ts:load': 'modified', 'c.ts:brandNew': 'added' });
    },
  ],
  [
    'when the call hierarchy names a method by another position, the change, its caller and its signature stay on one row',
    async () => {
      const repo = h.gitRepo('diff-alias');
      repo.write('lib.ts', 'export function load(id: string) {\n  return id;\n}\n');
      repo.write('use.ts', 'export function run() {\n  return load("y");\n}\n');
      repo.sh('git add -A && git commit -q -m first');
      repo.write('lib.ts', 'export function load(id: number) {\n  return id;\n}\n');
      globalThis.__chAtLineStart = true;
      try {
        const r = await changed(repo, 'uncommitted');
        const rows = r.data.files.flatMap((f) => f.symbols).filter((s) => s.name === 'load');
        assert.strictEqual(rows.length, 1, 'one row for load()');
        assert.deepStrictEqual(r.methods, { 'lib.ts:load': 'modified' });
        assert.ok(r.data.diff.signatures[rows[0].id], 'the signature change is on that row');
        assert.ok(r.data.edges.some((e) => e.target === rows[0].id), 'and so is the call from run()');
        assert.ok(!r.other.some((l) => /load/.test(l)), 'not reported as a changed value');
      } finally {
        delete globalThis.__chAtLineStart;
      }
    },
  ],
];
