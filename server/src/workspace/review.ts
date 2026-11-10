import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ChatRun } from '../../../shared/protocol.js';
import { openPr, prForBranch } from '../integrations/github.js';
import { defaultBase, safeGit } from './git.js';

export class ReviewError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The worktree's .git file is written by the agent, so it must still point at this repo's worktree entry for the branch before the server runs git there.
async function intact({ repo, worktree, branch }: ChatRun) {
  if (!repo || !worktree || !branch) return false;
  if (!(await lstat(worktree)).isDirectory()) return false;
  const dotgit = path.join(worktree, '.git');
  if (!(await lstat(dotgit)).isFile()) return false;
  const target = /^gitdir: (.+)$/m.exec(await readFile(dotgit, 'utf8'))?.[1].trim();
  if (!target) return false;
  const gitdir = await realpath(path.resolve(worktree, target));
  if (path.dirname(gitdir) !== (await realpath(path.join(repo, '.git', 'worktrees')))) return false;
  if ((await readFile(path.join(gitdir, 'gitdir'), 'utf8')).trim() !== path.join(await realpath(worktree), '.git')) return false;
  return (await readFile(path.join(gitdir, 'HEAD'), 'utf8')).trim() === `ref: refs/heads/${branch}`;
}

// The worktree of a run, once it has passed the check above.
export async function runWorktree(run: ChatRun) {
  if (!(await intact(run).catch(() => false))) throw new ReviewError(409, 'The worktree was changed');
  return run.worktree!;
}

const subjectOf = (run: ChatRun) => (run.rounds.at(-1)?.line || run.title).replace(/\s+/g, ' ').trim().slice(0, 72);

// Commits what is uncommitted, pushes the branch and returns the URL of its PR, opening one when there is none. A retry skips the steps already done.
export async function approveRun(run: ChatRun) {
  const cwd = await runWorktree(run);
  const branch = run.branch!;
  const subject = subjectOf(run);
  if ((await safeGit(cwd, ['status', '--porcelain'])).trim()) {
    await safeGit(cwd, ['add', '-A']);
    await safeGit(cwd, ['commit', '--no-verify', '-q', '-m', subject]);
  }
  const head = (await safeGit(cwd, ['rev-parse', 'HEAD'])).trim();
  const remote = (await safeGit(cwd, ['ls-remote', 'origin', `refs/heads/${branch}`]).catch(() => '')).split('\t')[0];
  if (remote !== head) await safeGit(cwd, ['push', '-u', 'origin', `refs/heads/${branch}`]);
  const base = (await defaultBase(cwd)).replace(/^origin\//, '');
  return (await prForBranch(run.repo!, branch)) ?? (await openPr(run.repo!, branch, base, subject, `Opened from the scheduled job ${run.title}.`));
}
