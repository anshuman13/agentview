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
  if (!repo || !worktree || !branch) return undefined;
  if (!(await lstat(worktree)).isDirectory()) return undefined;
  const dotgit = path.join(worktree, '.git');
  if (!(await lstat(dotgit)).isFile()) return undefined;
  const target = /^gitdir: (.+)$/m.exec(await readFile(dotgit, 'utf8'))?.[1].trim();
  if (!target) return undefined;
  const gitdir = await realpath(path.resolve(worktree, target));
  if (path.dirname(gitdir) !== (await realpath(path.join(repo, '.git', 'worktrees')))) return undefined;
  if ((await readFile(path.join(gitdir, 'gitdir'), 'utf8')).trim() !== path.join(await realpath(worktree), '.git')) return undefined;
  return (await readFile(path.join(gitdir, 'HEAD'), 'utf8')).trim() === `ref: refs/heads/${branch}` ? gitdir : undefined;
}

// The worktree of a run once it has passed the check above, with the environment that pins git to the checked gitdir.
export async function runWorktree(run: ChatRun) {
  const gitDir = await intact(run).catch(() => undefined);
  if (!gitDir) throw new ReviewError(409, 'The worktree was changed');
  return { cwd: run.worktree!, env: { GIT_DIR: gitDir, GIT_WORK_TREE: run.worktree! } };
}

// A nested repository would run its own config (filters) when git adds or inspects it.
async function refuseNested(git: (args: string[]) => Promise<string>, cwd: string) {
  const dirs = (await git(['ls-files', '-z', '--others', '--directory', '--exclude-standard'])).split('\0').filter((p) => p.endsWith('/'));
  const nested = await Promise.all(dirs.map((d) => lstat(path.join(cwd, d, '.git')).then(() => true, () => false)));
  if (nested.includes(true) || (await git(['ls-files', '-s'])).split('\n').some((l) => l.startsWith('160000'))) throw new ReviewError(409, 'The worktree holds a nested repository');
}

const subjectOf = (run: ChatRun) => (run.rounds.at(-1)?.line || run.title).replace(/\s+/g, ' ').trim().slice(0, 72);

// Commits what is uncommitted, pushes the branch and returns the URL of its PR, opening one when there is none. A retry skips the steps already done.
export async function approveRun(run: ChatRun) {
  const { cwd, env } = await runWorktree(run);
  const git = (args: string[]) => safeGit(cwd, args, undefined, env);
  const branch = run.branch!;
  const subject = subjectOf(run);
  await refuseNested(git, cwd);
  if ((await git(['status', '--porcelain', '--ignore-submodules=all'])).trim()) {
    await git(['add', '-A']);
    await git(['commit', '--no-verify', '-q', '-m', subject]);
  }
  const head = (await git(['rev-parse', 'HEAD'])).trim();
  const remote = (await git(['ls-remote', 'origin', `refs/heads/${branch}`]).catch(() => '')).split('\t')[0];
  if (remote !== head) await git(['push', '-u', 'origin', `refs/heads/${branch}`]);
  const base = (await defaultBase(cwd, env)).replace(/^origin\//, '');
  return (await prForBranch(run.repo!, branch)) ?? (await openPr(run.repo!, branch, base, subject, `Opened from the scheduled job ${run.title}.`));
}
