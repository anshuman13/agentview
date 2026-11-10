import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { createWorktree } from './worktrees.js';

const run = promisify(execFile);

export const TRIES_USAGE = 'Usage: /tries <2-4> <prompt>, starts the prompt in that many new worktrees';

// /tries 3 <prompt> runs the same prompt in 3 new worktrees, so the best attempt can be kept.
export function parseTries(text: string): { n: number; prompt: string } | 'usage' | null {
  const m = /^\/tries\b([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const t = /^\s+([2-4])\s+(\S[\s\S]*)$/.exec(m[1]);
  return t ? { n: Number(t[1]), prompt: t[2].trim() } : 'usage';
}

export function triesBranches(prompt: string, n: number, now = new Date()) {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 4).join('-') || 'try';
  const stamp = now.toISOString().slice(5, 16).replace(/\D/g, '');
  return Array.from({ length: n }, (_, i) => `tries/${slug}-${stamp}-${i + 1}`);
}

// The main checkout of the repo the chat is in, also when the chat runs inside one of its worktrees.
export async function mainCheckout(cwd: string) {
  const { stdout } = await run('git', ['-C', cwd, 'worktree', 'list', '--porcelain']);
  return stdout.split('\n')[0].replace(/^worktree /, '');
}

// Without Paseo a try is a plain git worktree in a hidden .tries folder next to the repo, which the repo list skips.
async function gitWorktree(repo: string, branch: string) {
  const dir = path.join(path.dirname(repo), '.tries', `${path.basename(repo)}-${branch.split('/').pop()}`);
  const base = (await run('git', ['-C', repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => ({ stdout: 'HEAD' }))).stdout.trim();
  await run('git', ['-C', repo, 'worktree', 'add', '-b', branch, dir, base]);
  return dir;
}

export async function startTries(cwd: string, n: number, prompt: string, ask: (cwd: string, prompt: string) => Promise<string>) {
  const repo = await mainCheckout(cwd);
  const make = (b: string) => createWorktree(repo, b).catch((err) => (/not installed|not a Paseo project/.test(String(err)) ? gitWorktree(repo, b) : Promise.reject(err)));
  const branches = triesBranches(prompt, n);
  const cwds = [];
  for (const b of branches) cwds.push(await make(b));
  const ids = await Promise.all(cwds.map((c) => ask(c, prompt)));
  return ids.map((id, i) => ({ id, branch: branches[i] }));
}
