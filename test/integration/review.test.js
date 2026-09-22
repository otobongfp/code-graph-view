// The parts of change review that read real git: removed methods, old-to-new line mapping, and comparing with a named base.
const assert = require('assert');
const path = require('path');
const h = require('./helpers');

const { computeDiff, mapLineBack, readAtRef } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'git.ts')));
const { findRemoved } = h.freshRequire(h.bundleNode(path.join(h.root, 'src', 'removedCode.ts')));

function repoWith(files) {
  const repo = h.gitRepo('review');
  for (const [name, text] of Object.entries(files)) {
    const dir = path.dirname(path.join(repo.dir, name));
    require('fs').mkdirSync(dir, { recursive: true });
    repo.write(name, text);
  }
  repo.sh('git add -A && git commit -q -m base');
  return repo;
}

module.exports = [
  [
    'a removed method that something still calls is reported with where',
    async () => {
      const repo = repoWith({
        'lib.ts': 'export function keep() {\n  return 1;\n}\nexport function oldHelper() {\n  return 2;\n}\n',
        'use.ts': 'import { oldHelper } from "./lib";\nexport function run() {\n  return oldHelper();\n}\n',
      });
      repo.write('lib.ts', 'export function keep() {\n  return 1;\n}\n');
      const removed = await findRemoved(repo.dir, await computeDiff(repo.dir, 'uncommitted'));
      assert.deepStrictEqual(removed.map((r) => r.name), ['oldHelper']);
      assert.strictEqual(removed[0].file, 'lib.ts');
      assert.deepStrictEqual(removed[0].refs, [{ file: 'use.ts', line: 3 }]);
    },
  ],
  [
    'a removed method nobody calls, or one that only moved, is not reported',
    async () => {
      const repo = repoWith({
        'a.ts': 'export function unused() {\n  return 1;\n}\nexport function moved() {\n  return 2;\n}\n',
        'b.ts': 'export function other() {\n  return moved();\n}\n',
      });
      repo.write('a.ts', '');
      repo.write('b.ts', 'export function other() {\n  return moved();\n}\nexport function moved() {\n  return 2;\n}\n');
      const removed = await findRemoved(repo.dir, await computeDiff(repo.dir, 'uncommitted'));
      assert.deepStrictEqual(removed, []);
    },
  ],
  [
    'a deleted file counts as removing its methods, but calls inside deleted files do not count',
    async () => {
      const repo = repoWith({
        'gone.ts': 'export function vanish() {\n  return 1;\n}\n',
        'caller.ts': 'export function c() {\n  return vanish();\n}\n',
      });
      require('fs').unlinkSync(path.join(repo.dir, 'gone.ts'));
      const removed = await findRemoved(repo.dir, await computeDiff(repo.dir, 'uncommitted'));
      assert.deepStrictEqual(removed.map((r) => [r.name, r.refs.map((x) => x.file)]), [['vanish', ['caller.ts']]]);
    },
  ],
  [
    'a line in the new file maps back to where it sat in the old one',
    async () => {
      const repo = repoWith({ 'a.ts': ['l1', 'l2', 'l3', 'l4', 'l5', ''].join('\n') });
      repo.write('a.ts', ['new1', 'new2', 'l1', 'l2', 'changed', 'l4', 'l5', ''].join('\n'));
      const diff = await computeDiff(repo.dir, 'uncommitted');
      const hunks = diff.files[0].hunks;
      assert.ok(hunks && hunks.length > 0, 'working-tree diffs keep their hunks');
      assert.strictEqual(mapLineBack(hunks, 3), 1, 'l1 moved down by two');
      assert.strictEqual(mapLineBack(hunks, 7), 5, 'l5 too');
      assert.strictEqual(await readAtRef(repo.dir, 'HEAD', 'a.ts'), ['l1', 'l2', 'l3', 'l4', 'l5', ''].join('\n'));
      assert.strictEqual(await readAtRef(repo.dir, 'HEAD', 'nope.ts'), undefined);
    },
  ],
  [
    'a named base compares against it, and refuses something that is not a branch',
    async () => {
      const repo = repoWith({ 'a.ts': 'export function a() {\n  return 1;\n}\n' });
      repo.sh('git checkout -q -b topic');
      repo.write('a.ts', 'export function a() {\n  return 2;\n}\n');
      repo.sh('git commit -q -am change');
      const diff = await computeDiff(repo.dir, 'branch:main');
      assert.deepStrictEqual(diff.files.map((f) => f.path), ['a.ts']);
      assert.ok(diff.title.includes('main'));
      await assert.rejects(computeDiff(repo.dir, 'branch:nope'), /Could not find/);
      await assert.rejects(computeDiff(repo.dir, 'branch:--output=/tmp/x'), /not a branch name/);
    },
  ],
  [
    'a removed 2-character method is detected, while unrelated files without module proximity are skipped',
    async () => {
      const repo = repoWith({
        'src/actions/runner.ts': 'export function on() {\n  return 1;\n}\nexport function render() {\n  return 2;\n}\n',
        'src/actions/consumer.ts': 'import { on, render } from "./runner";\nexport function act() {\n  on();\n  return render();\n}\n',
        'src/other/unrelated.ts': 'export function separate() {\n  // unrelated coincidental call without importing the source module\n  return render();\n}\n',
      });
      repo.write('src/actions/runner.ts', 'export function keep() {\n  return 0;\n}\n');
      const removed = await findRemoved(repo.dir, await computeDiff(repo.dir, 'uncommitted'));
      const names = removed.map((r) => r.name).sort();
      assert.ok(names.includes('on'), '2-char method "on" is found');
      assert.ok(names.includes('render'), 'common-named method "render" is found when imported');
      const renderEntry = removed.find((r) => r.name === 'render');
      assert.deepStrictEqual(renderEntry.refs.map((x) => x.file), ['src/actions/consumer.ts'], 'unrelated file is excluded');
    },
  ],
];
