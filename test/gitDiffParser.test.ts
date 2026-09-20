import * as assert from 'assert';
import { parseDiff } from '../src/git';

describe('Feature: Git Diff & Changed Symbols Parser', () => {
  it('parses modified file with single hunk correctly', () => {
    const rawDiff = `diff --git a/src/user.ts b/src/user.ts
index 1234567..89abcdef 100644
--- a/src/user.ts
+++ b/src/user.ts
@@ -10,4 +10,6 @@
 unchanged line 1
+added line 1
+added line 2
 unchanged line 2`;

    const result = parseDiff(rawDiff);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'src/user.ts');
    assert.strictEqual(result[0].status, 'modified');
    assert.strictEqual(result[0].hunks.length, 1);
    assert.strictEqual(result[0].hunks[0].oldStart, 10);
    assert.strictEqual(result[0].hunks[0].oldCount, 4);
    assert.strictEqual(result[0].hunks[0].newStart, 10);
    assert.strictEqual(result[0].hunks[0].newCount, 6);
  });

  it('parses newly added files and sets status to added', () => {
    const rawDiff = `diff --git a/src/newFile.ts b/src/newFile.ts
new file mode 100644
index 0000000..89abcdef
--- /dev/null
+++ b/src/newFile.ts
@@ -0,0 +1,15 @@
+export function hello() {}`;

    const result = parseDiff(rawDiff);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'src/newFile.ts');
    assert.strictEqual(result[0].status, 'added');
    assert.strictEqual(result[0].hunks[0].newStart, 1);
    assert.strictEqual(result[0].hunks[0].newCount, 15);
  });

  it('parses deleted files and sets status to deleted', () => {
    const rawDiff = `diff --git a/src/oldFile.ts b/src/oldFile.ts
deleted file mode 100644
index 89abcdef..0000000
--- a/src/oldFile.ts
+++ /dev/null
@@ -1,10 +0,0 @@
-export function old() {}`;

    const result = parseDiff(rawDiff);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'src/oldFile.ts');
    assert.strictEqual(result[0].status, 'deleted');
  });

  it('parses multi-file diffs with multiple hunks per file', () => {
    const rawDiff = `diff --git a/file1.ts b/file1.ts
index 111..222 100644
--- a/file1.ts
+++ b/file1.ts
@@ -5,2 +5,4 @@
@@ -20,1 +22,1 @@
diff --git a/file2.ts b/file2.ts
index 333..444 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,5 +1,7 @@`;

    const result = parseDiff(rawDiff);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].path, 'file1.ts');
    assert.strictEqual(result[0].hunks.length, 2);
    assert.strictEqual(result[1].path, 'file2.ts');
    assert.strictEqual(result[1].hunks.length, 1);
  });
});
