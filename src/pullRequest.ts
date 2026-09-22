import { execFile } from 'child_process';
import { git } from './git';

/** Reads a pull request number from "123", "#123", or a GitHub-style ".../pull/123" link. */
export function parsePullRequestRef(input: string): number | undefined {
  const text = input.trim();
  const m = /^#?(\d{1,7})$/.exec(text) ?? /\/pull\/(\d{1,7})(?:[/?#]|$)/.exec(text);
  return m ? Number(m[1]) : undefined;
}

function gh(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(String(stderr).trim() || err.message), { code: (err as NodeJS.ErrnoException).code }));
      else resolve(String(stdout));
    });
  });
}

export interface CheckedOutPullRequest {
  /** The diff source to open: this branch against the PR's own base when that is known. */
  source: string;
  /** Set when the base could not be found out, so the comparison uses the default branch instead. */
  caveat?: string;
}

/**
 * Checks out pull request `number` so the language server can see its code, and says what to compare it with.
 * Uses the GitHub CLI when there is one (it also knows the base branch); otherwise fetches GitHub's pull ref.
 */
export async function checkoutPullRequest(root: string, number: number): Promise<CheckedOutPullRequest> {
  if ((await git(root, ['status', '--porcelain'])).trim()) {
    throw new Error('You have uncommitted changes. Commit or stash them before switching to the pull request.');
  }
  try {
    await gh(root, ['pr', 'checkout', String(number)]);
    try {
      const base = (await gh(root, ['pr', 'view', String(number), '--json', 'baseRefName', '--jq', '.baseRefName'])).trim();
      if (/^[\w][\w./-]*$/.test(base)) {
        await git(root, ['fetch', 'origin', base]).catch(() => undefined);
        return { source: `branch:origin/${base}` };
      }
    } catch {
      // fall through to the default base
    }
    return { source: 'branch', caveat: "Could not read the pull request's base branch, so it is compared with the default branch." };
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  const local = `pr-${number}`;
  try {
    await git(root, ['fetch', 'origin', `pull/${number}/head:refs/heads/${local}`]);
  } catch {
    throw new Error(
      `Could not fetch pull request #${number} from "origin". Install the GitHub CLI (gh) or check the number and remote.`
    );
  }
  await git(root, ['checkout', local]);
  return { source: 'branch', caveat: 'Install the GitHub CLI (gh) to compare with the pull request\'s own base branch; the default branch is used.' };
}
