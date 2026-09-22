import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GitStatusSummary } from './types';

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

interface FileDiff {
  path: string;
  status: 'added' | 'deleted' | 'modified';
  hunks: Hunk[];
}

/** Lines are 1-based and inclusive, in the file as it is on disk now. */
export interface ChangedRange {
  start: number;
  end: number;
  pureAdd: boolean;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified';
  ranges: ChangedRange[];
  /** Old-to-new hunks; only kept when the new side is the file on disk, so line numbers can be mapped back. */
  hunks?: Hunk[];
  /** False when the code changed since the diff's version, so positions are estimated. */
  exact: boolean;
}

export interface DiffResult {
  title: string;
  files: FileChange[];
  deleted: string[];
  /** The two sides of the diff as git refs: '' is the index, null on the left is "nothing" and on the right the working tree. */
  refs: { left: string | null; right: string | null };
}

export interface CommitInfo {
  sha: string;
  subject: string;
  author: string;
  when: string;
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_UNTRACKED_BYTES = 2_000_000;

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr).trim() || err.message));
        } else {
          resolve(String(stdout));
        }
      }
    );
  });
}

export async function repoRootFor(dir: string): Promise<string> {
  let folder = dir;
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isFile()) {
      folder = path.dirname(dir);
    }
  } catch {}
  return (await git(folder, ['rev-parse', '--show-toplevel'])).trim();
}

export async function listRecentCommits(root: string, count = 40): Promise<CommitInfo[]> {
  const out = await git(root, ['log', '-n', String(count), '--pretty=format:%h%x1f%s%x1f%an%x1f%ar']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, author, when] = line.split('\x1f');
      return { sha, subject, author, when };
    });
}

/** Parses `git diff -U0` output into per-file hunks. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: '', status: 'modified', hunks: [] };
      files.push(current);
      const m = / b\/(.+)$/.exec(line);
      if (m) current.path = m[1];
    } else if (!current) {
      continue;
    } else if (line.startsWith('new file mode')) {
      current.status = 'added';
    } else if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
    } else if (line.startsWith('--- a/') && current.status === 'deleted') {
      current.path = line.slice(6).replace(/\t.*$/, '');
    } else if (line.startsWith('+++ b/')) {
      current.path = line.slice(6).replace(/\t.*$/, '');
    } else if (line.startsWith('@@ ')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        current.hunks.push({
          oldStart: Number(m[1]),
          oldCount: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newCount: m[4] === undefined ? 1 : Number(m[4]),
        });
      }
    }
  }
  return files.filter((f) => f.path);
}

/** Where line `line` of the old version sits in the new version; inexact if that region was rewritten. */
export function mapLine(hunks: Hunk[], line: number): { line: number; exact: boolean } {
  let offset = 0;
  for (const h of hunks) {
    if (h.oldCount === 0) {
      // Pure insertion after old line `oldStart`.
      if (h.oldStart < line) offset += h.newCount;
      else break;
    } else if (h.oldStart + h.oldCount - 1 < line) {
      offset += h.newCount - h.oldCount;
    } else if (h.oldStart <= line) {
      const inside = Math.min(line - h.oldStart, Math.max(h.newCount - 1, 0));
      return { line: Math.max(1, h.newStart + inside), exact: false };
    } else {
      break;
    }
  }
  return { line: Math.max(1, line + offset), exact: true };
}

function rangesOf(hunks: Hunk[]): ChangedRange[] {
  return hunks.map((h) =>
    h.newCount > 0
      ? { start: h.newStart, end: h.newStart + h.newCount - 1, pureAdd: h.oldCount === 0 }
      : // A deletion: touch the lines on both sides of where the code was removed.
        { start: Math.max(h.newStart, 1), end: h.newStart + 1, pureAdd: false }
  );
}

/** Where line `line` of the new version sat in the old version (approximate inside a rewritten region). */
export function mapLineBack(hunks: Hunk[], line: number): number {
  const swapped = hunks.map((h) => ({ oldStart: h.newStart, oldCount: h.newCount, newStart: h.oldStart, newCount: h.oldCount }));
  return mapLine(swapped, line).line;
}

/** The contents of `file` at a git ref ('' is the index), or undefined if it did not exist there. */
export async function readAtRef(root: string, ref: string, file: string): Promise<string | undefined> {
  try {
    return await git(root, ['show', `${ref}:${file}`]);
  } catch {
    return undefined;
  }
}

async function hasHead(root: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

async function resolveBase(root: string): Promise<string> {
  // 1. Try remote origin/HEAD
  try {
    const head = (await git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    if (head) return head;
  } catch {}

  // 2. Try upstream branch of current HEAD
  try {
    const upstream = (await git(root, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim();
    if (upstream && upstream !== 'HEAD') return upstream;
  } catch {}

  // 3. Try common remote branch names
  for (const name of ['origin/main', 'origin/master', 'origin/develop', 'origin/trunk', 'upstream/main', 'upstream/master']) {
    try {
      await git(root, ['rev-parse', '--verify', '--quiet', name]);
      return name;
    } catch {}
  }

  // 4. Try local branch names (excluding current branch if possible)
  let currentBranch = '';
  try {
    currentBranch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {}

  for (const name of ['main', 'master', 'develop', 'trunk']) {
    if (name === currentBranch) continue;
    try {
      await git(root, ['rev-parse', '--verify', '--quiet', name]);
      return name;
    } catch {}
  }

  // 5. Try origin directly if available
  try {
    await git(root, ['rev-parse', '--verify', '--quiet', 'origin']);
    return 'origin';
  } catch {}

  // 6. If on main/master with commits, compare against previous commit HEAD~1
  if (currentBranch) {
    try {
      await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD~1']);
      return 'HEAD~1';
    } catch {}
  }

  throw new Error('Could not find a base branch (origin/main, origin/master, main, master, develop) to compare against.');
}

async function untrackedFiles(root: string): Promise<FileChange[]> {
  try {
    const out = await git(root, ['ls-files', '--others', '--exclude-standard']);
    const files: FileChange[] = [];
    for (const rel of out.split('\n').filter(Boolean)) {
      try {
        const abs = path.join(root, rel);
        if (fs.statSync(abs).size > MAX_UNTRACKED_BYTES) continue;
        const text = fs.readFileSync(abs, 'utf8');
        const lines = Math.max(1, text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
        files.push({ path: rel, status: 'added', ranges: [{ start: 1, end: lines, pureAdd: true }], exact: true });
      } catch {
        // unreadable or vanished; skip it
      }
    }
    return files;
  } catch {
    return [];
  }
}

/**
 * Changed line ranges for a source: 'uncommitted', 'unstaged', 'staged', 'branch' (vs main),
 * or 'commit:<sha>'. Ranges are always reported against the files as they are on disk now.
 */
export async function computeDiff(root: string, source: string): Promise<DiffResult> {
  const flags = ['-U0', '--no-color', '--no-ext-diff'];
  let title: string;
  let diffText = '';
  /** Which version of a file the diff's "new" side is, so we can carry its line numbers to disk. */
  let side: 'worktree' | 'index' | { ref: string } = 'worktree';
  let withUntracked = true;
  const repoHasHead = await hasHead(root);
  const refs: DiffResult['refs'] = { left: repoHasHead ? 'HEAD' : null, right: null };

  if (source === 'uncommitted') {
    title = 'Uncommitted changes';
    if (repoHasHead) {
      diffText = await git(root, ['diff', ...flags, 'HEAD']);
    } else {
      diffText = await git(root, ['diff', ...flags]).catch(() => '');
    }
  } else if (source === 'unstaged') {
    title = 'Unstaged changes';
    refs.left = '';
    diffText = await git(root, ['diff', ...flags]).catch(() => '');
  } else if (source === 'staged') {
    title = 'Staged changes';
    if (repoHasHead) {
      diffText = await git(root, ['diff', '--cached', ...flags]);
    } else {
      diffText = await git(root, ['diff', '--cached', ...flags, EMPTY_TREE]).catch(() => '');
    }
    side = 'index';
    refs.right = '';
    withUntracked = false;
  } else if (source === 'branch' || source.startsWith('branch:')) {
    if (!repoHasHead) {
      throw new Error('No commits in repository yet. Commit your changes first.');
    }
    let base: string;
    if (source === 'branch') {
      base = await resolveBase(root);
    } else {
      base = source.slice('branch:'.length);
      if (!/^[\w][\w./-]*$/.test(base)) throw new Error('That is not a branch name.');
      await git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).catch(() => {
        throw new Error(`Could not find "${base}" to compare against.`);
      });
    }
    let mergeBase = '';
    try {
      mergeBase = (await git(root, ['merge-base', 'HEAD', base])).trim();
    } catch {}
    if (!mergeBase) mergeBase = base;
    title = `This branch vs ${base}`;
    refs.left = mergeBase;
    diffText = await git(root, ['diff', ...flags, mergeBase]);
  } else if (source.startsWith('commit:')) {
    const sha = source.slice('commit:'.length);
    if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) throw new Error('That is not a commit id.');
    const subject = (await git(root, ['show', '-s', '--format=%h %s', sha])).trim();
    title = subject;
    let parent = EMPTY_TREE;
    try {
      parent = (await git(root, ['rev-parse', '--verify', `${sha}^1`])).trim();
    } catch {
      // root commit: compare against the empty tree
    }
    diffText = await git(root, ['diff', ...flags, parent, sha]);
    side = { ref: sha };
    refs.left = parent === EMPTY_TREE ? null : parent;
    refs.right = sha;
    withUntracked = false;
  } else {
    throw new Error(`Unknown diff source: ${source}`);
  }

  const files: FileChange[] = [];
  const deleted: string[] = [];
  // Moving a commit's or the index's line numbers to the file on disk needs one more diff, taken once for all files.
  let carries: Map<string, FileDiff> | undefined;
  if (side !== 'worktree') {
    try {
      const text = await git(root, side === 'index' ? ['diff', ...flags] : ['diff', ...flags, side.ref]);
      carries = new Map(parseDiff(text).map((f) => [f.path, f]));
    } catch {
      carries = undefined;
    }
  }
  for (const file of parseDiff(diffText)) {
    if (file.status === 'deleted') {
      deleted.push(file.path);
      continue;
    }
    const abs = path.join(root, file.path);
    if (!fs.existsSync(abs)) continue;
    let ranges = rangesOf(file.hunks);
    let exact = true;
    if (side !== 'worktree') {
      if (!carries) {
        exact = false;
      } else {
        const carry = carries.get(file.path);
        if (carry && carry.status !== 'deleted') {
          ranges = ranges.map((r) => {
            const a = mapLine(carry.hunks, r.start);
            const b = mapLine(carry.hunks, r.end);
            exact = exact && a.exact && b.exact;
            return { start: a.line, end: Math.max(a.line, b.line), pureAdd: r.pureAdd };
          });
        }
      }
    }
    files.push({
      path: file.path,
      status: file.status === 'added' ? 'added' : 'modified',
      ranges,
      exact,
      hunks: file.hunks,
    });
  }
  if (withUntracked) {
    const seen = new Set(files.map((f) => f.path));
    for (const f of await untrackedFiles(root)) if (!seen.has(f.path)) files.push(f);
  }
  return { title, files, deleted, refs };
}

export async function getGitStatusSummary(root: string): Promise<GitStatusSummary> {
  const repoHasHead = await hasHead(root);
  const commits = await listRecentCommits(root);
  let unstagedCount = 0;
  let stagedCount = 0;
  let uncommittedCount = 0;
  let branchCount = 0;
  let baseBranch: string | undefined;

  try {
    const statusOut = await git(root, ['status', '--porcelain=v1', '-uall']);
    for (const line of statusOut.split('\n').filter(Boolean)) {
      const x = line[0];
      const y = line[1];
      if (x !== ' ' && x !== '?') stagedCount++;
      if (y !== ' ' && y !== '?') unstagedCount++;
      uncommittedCount++;
    }
  } catch {}

  if (repoHasHead) {
    try {
      baseBranch = await resolveBase(root);
      const mergeBase = (await git(root, ['merge-base', 'HEAD', baseBranch])).trim();
      const diffOut = await git(root, ['diff', '--name-only', mergeBase || baseBranch]);
      branchCount = diffOut.split('\n').filter(Boolean).length;
    } catch {}
  }

  return {
    hasHead: repoHasHead,
    uncommittedCount,
    unstagedCount,
    stagedCount,
    branchCount,
    baseBranch,
    commits,
  };
}
