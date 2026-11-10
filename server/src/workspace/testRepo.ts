import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatRun } from '../../../shared/protocol.js';

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });

export const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString();

// A temp repo with no remote, whose origin/main is its first commit, and a jobs/ worktree on a new branch; a job run for it.
export function jobRepo() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'review-')));
  const repo = path.join(root, 'repo');
  const dir = path.join(root, 'wt');
  const branch = 'jobs/test-1';
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  sh(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  sh(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  sh(repo, 'worktree', 'add', '-q', '-b', branch, dir, 'origin/main');
  const run: ChatRun = { id: 'r1', kind: 'job', sessionId: 's1', chatId: 'c1', title: 'Fix the test', what: 'w', startedAt: 0, endedAt: null, state: 'paused', why: 'Ready for review', round: 0, max: 0, nextAt: null, costUsd: 0, rounds: [], needsYou: true, repo, worktree: dir, branch, paseo: false, review: 'pending' };
  return { root, repo, dir, branch, run };
}
