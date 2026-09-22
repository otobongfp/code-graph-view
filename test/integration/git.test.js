// Runs the real git binary against a throwaway repository: changed lines for every source, carried onto today's code.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const { computeDiff, mapLine } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'git.ts')));

const A1 = ['export function one() {', '  return 1;', '}', '', 'export function two() {', '  return 2;', '}', '', 'export function three() {', '  return 3;', '}', ''].join('\n');
const A2 = A1.replace('  return 2;', '  return 22;') + 'export function four() {\n  return 4;\n}\n';

/** { 'a.ts': ['1-2+'] }: line ranges per file, "+" when the range is pure addition. */
const ranges = (diff) => Object.fromEntries(diff.files.map((f) => [f.path, f.ranges.map((r) => `${r.start}-${r.end}${r.pureAdd ? '+' : ''}`)]));

/** The repository after: commit 1, commit 2 (change two, add four), then a 2-line header (unstaged), a staged edit to b.ts, an untracked c.ts. */
function scenario() {
  const repo = h.gitRepo('git');
  repo.write('a.ts', A1);
  repo.write('b.ts', 'export function b1() {\n  return 1;\n}\n');
  repo.sh('git add -A && git commit -q -m first');
  repo.write('a.ts', A2);
  repo.sh('git commit -q -am "change two, add four"');
  const sha = repo.sh('git rev-parse --short HEAD').trim();
  repo.write('a.ts', '// header\n// more\n' + A2);
  repo.write('b.ts', 'export function b1() {\n  return 100;\n}\n');
  repo.sh('git add b.ts');
  repo.write('c.ts', 'export function c1() {\n  return 1;\n}\n');
  return { repo, sha };
}

module.exports = [
  [
    'each source says which two versions it compares, so a change can be opened as a before/after view',
    async () => {
      const { repo, sha } = scenario();
      assert.deepStrictEqual((await computeDiff(repo.dir, 'uncommitted')).refs, { left: 'HEAD', right: null });
      assert.deepStrictEqual((await computeDiff(repo.dir, 'unstaged')).refs, { left: '', right: null }, 'unstaged compares the index with the file');
      assert.deepStrictEqual((await computeDiff(repo.dir, 'staged')).refs, { left: 'HEAD', right: '' });
      const commit = (await computeDiff(repo.dir, `commit:${sha}`)).refs;
      assert.strictEqual(commit.right, sha);
      assert.ok(commit.left && commit.left !== commit.right, 'a commit compares with its parent');
    },
  ],
  [
    'unstaged: the edited file and the untracked file, not the staged one',
    async () => {
      const { repo } = scenario();
      assert.deepStrictEqual(ranges(await computeDiff(repo.dir, 'unstaged')), { 'a.ts': ['1-2+'], 'c.ts': ['1-3+'] });
    },
  ],
  [
    'staged: only what is in the index',
    async () => {
      const { repo } = scenario();
      assert.deepStrictEqual(ranges(await computeDiff(repo.dir, 'staged')), { 'b.ts': ['2-2'] });
    },
  ],
  [
    'uncommitted: staged, unstaged and untracked together',
    async () => {
      const { repo } = scenario();
      assert.deepStrictEqual(ranges(await computeDiff(repo.dir, 'uncommitted')), { 'a.ts': ['1-2+'], 'b.ts': ['2-2'], 'c.ts': ['1-3+'] });
    },
  ],
  [
    'a commit is reported where the code sits now (the file has since shifted by two lines)',
    async () => {
      const { repo, sha } = scenario();
      const diff = await computeDiff(repo.dir, `commit:${sha}`);
      assert.deepStrictEqual(ranges(diff), { 'a.ts': ['8-8', '14-16+'] });
      assert.strictEqual(diff.files[0].exact, true);
      assert.ok(diff.title.includes('change two, add four'));
    },
  ],
  [
    'a commit whose changed region was rewritten since is flagged as estimated',
    async () => {
      const { repo, sha } = scenario();
      repo.write('a.ts', ('// header\n// more\n' + A2).replace('  return 22;', '  return 2222;\n  // extra'));
      const diff = await computeDiff(repo.dir, `commit:${sha}`);
      assert.strictEqual(diff.files[0].exact, false, 'the rewritten region cannot be placed exactly');
      assert.deepStrictEqual(ranges(diff)['a.ts'], ['8-8', '15-17+'], 'the added method still shifts by the extra line');
    },
  ],
  [
    'branch: everything since the merge base, including a removed method',
    async () => {
      const { repo } = scenario();
      repo.sh('git checkout -q -b feature');
      repo.write('a.ts', A1.replace(/export function three[\s\S]*/, ''));
      repo.sh('git commit -q -am "remove three"');
      const diff = await computeDiff(repo.dir, 'branch');
      assert.deepStrictEqual(Object.keys(ranges(diff)).sort(), ['a.ts', 'b.ts', 'c.ts']);
      assert.deepStrictEqual(ranges(diff)['a.ts'], ['6-6', '8-9']);
    },
  ],
  [
    'deleted files are listed separately',
    async () => {
      const { repo } = scenario();
      fs.unlinkSync(path.join(repo.dir, 'b.ts'));
      assert.deepStrictEqual((await computeDiff(repo.dir, 'unstaged')).deleted, ['b.ts']);
    },
  ],
  [
    'a commit id is validated, so it can never be read as a git option',
    async () => {
      const { repo } = scenario();
      await assert.rejects(computeDiff(repo.dir, 'commit:--output=/tmp/x'), /not a commit id/);
    },
  ],
  [
    'line mapping: insertions shift later lines, rewritten lines are marked inexact',
    () => {
      const insertion = [{ oldStart: 3, oldCount: 0, newStart: 4, newCount: 2 }];
      assert.deepStrictEqual(mapLine(insertion, 3), { line: 3, exact: true });
      assert.deepStrictEqual(mapLine(insertion, 4), { line: 6, exact: true });
      assert.deepStrictEqual(mapLine([{ oldStart: 5, oldCount: 2, newStart: 5, newCount: 0 }], 9), { line: 7, exact: true });
      assert.strictEqual(mapLine([{ oldStart: 5, oldCount: 2, newStart: 5, newCount: 3 }], 6).exact, false);
    },
  ],
];
