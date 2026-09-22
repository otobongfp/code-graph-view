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
];
