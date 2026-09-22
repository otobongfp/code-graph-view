import * as fs from 'fs';
import * as path from 'path';
import { declaredNames } from './declarations';
import { DiffResult, git, readAtRef } from './git';

export interface RemovedMethod {
  name: string;
  /** The file it was declared in (repo-relative). */
  file: string;
  /** Places that still mention it as a call. Text search by name, so unrelated code with the same name can appear. */
  refs: Array<{ file: string; line: number }>;
}

const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py)$/;
const SKIPPED = /(^|\/)(node_modules|dist|out|build|\.next|vendor|target|\.venv|venv|site-packages|__pycache__)\//;
const TESTISH = /(\.(spec|test)\.[cm]?[jt]sx?$)|(_test\.go$)|(test_.*\.py$)|(_test\.py$)|(\/__tests__\/)/;
/** Names too common for a text search to mean anything. */
const COMMON = new Set(['get', 'set', 'run', 'main', 'init', 'test', 'render', 'toString', 'handle', 'update', 'add', 'remove', 'map', 'call', 'then']);
const MAX_FILES = 150;
const MAX_NAMES = 40;
const MAX_REFS = 20;

async function readNew(root: string, refs: DiffResult['refs'], file: string): Promise<string | undefined> {
  if (refs.right === null) {
    try {
      return fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      return undefined;
    }
  }
  return readAtRef(root, refs.right, file);
}

async function findRefs(
  root: string,
  refs: DiffResult['refs'],
  name: string,
  gone: Set<string>,
  declaringFile: string
): Promise<RemovedMethod['refs']> {
  const pattern = `(^|[^A-Za-z0-9_$])${name}[[:space:]]*\\(`;
  const args =
    refs.right === null
      ? ['grep', '-n', '-I', '--untracked', '-E', '-e', pattern]
      : refs.right === ''
        ? ['grep', '-n', '-I', '--cached', '-E', '-e', pattern]
        : ['grep', '-n', '-I', '-E', '-e', pattern, refs.right];
  let out = '';
  try {
    out = await git(root, args);
  } catch {
    return []; // git grep exits non-zero when nothing matches
  }

  const decDir = path.dirname(declaringFile);
  const rawBase = path.basename(declaringFile).replace(/\.[^.]+$/, '');
  const decBase = rawBase === 'index' || rawBase.length < 3 ? path.basename(decDir) : rawBase;

  const found: RemovedMethod['refs'] = [];
  for (const line of out.split('\n')) {
    const text = refs.right !== null && refs.right !== '' && line.startsWith(`${refs.right}:`) ? line.slice(refs.right.length + 1) : line;
    const m = /^(.+?):(\d+):/.exec(text);
    if (!m || gone.has(m[1]) || !CODE_FILE.test(m[1]) || SKIPPED.test(m[1])) continue;
    const matchFile = m[1];
    if (matchFile === declaringFile) continue;

    // Proximity check: same folder or mentions the declaring module/file name
    const matchDir = path.dirname(matchFile);
    if (COMMON.has(name) || matchDir !== decDir) {
      if (decBase && decBase !== '.' && decBase !== '/') {
        const matchText = (await readNew(root, refs, matchFile)) ?? '';
        if (!matchText.includes(decBase)) continue;
      }
    }

    found.push({ file: matchFile, line: Number(m[2]) });
    if (found.length >= MAX_REFS) break;
  }
  return found;
}

/**
 * Methods the change removed (or renamed away) that something still appears to call. Declarations are read from
 * the old and new text of each changed file, so a method that only moved to another changed file is not reported.
 */
export async function findRemoved(root: string, diff: DiffResult): Promise<RemovedMethod[]> {
  const { left } = diff.refs;
  if (left === null) return [];
  const candidates = [...diff.files.filter((f) => f.status === 'modified').map((f) => f.path), ...diff.deleted]
    .filter((f) => CODE_FILE.test(f) && !SKIPPED.test(f) && !TESTISH.test(f))
    .slice(0, MAX_FILES);
  const goneFiles = new Set(diff.deleted);

  const nowDeclared = new Set<string>();
  for (const f of diff.files) {
    const text = await readNew(root, diff.refs, f.path);
    if (text) declaredNames(text, f.path).forEach((n) => nowDeclared.add(n));
  }

  const removed: Array<{ name: string; file: string }> = [];
  const seen = new Set<string>();
  for (const file of candidates) {
    const before = await readAtRef(root, left, file);
    if (!before) continue;
    const after = goneFiles.has(file) ? '' : (await readNew(root, diff.refs, file)) ?? '';
    const still = new Set(declaredNames(after, file));
    for (const name of declaredNames(before, file)) {
      if (still.has(name) || nowDeclared.has(name) || seen.has(name) || name.length < 2 || name.includes('$')) continue;
      seen.add(name);
      removed.push({ name, file });
    }
  }

  const results: RemovedMethod[] = [];
  for (const r of removed.slice(0, MAX_NAMES)) {
    const refs = await findRefs(root, diff.refs, r.name, goneFiles, r.file);
    if (refs.length > 0) results.push({ ...r, refs });
  }
  return results;
}
