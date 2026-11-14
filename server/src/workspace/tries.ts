import path from 'node:path';
import { createWorktree } from './worktrees.js';
import { exec as run } from '../exec.js';


export const TRIES_USAGE = 'Usage: /tries <2-4> <prompt>, starts the prompt in that many new worktrees';

// /tries 3 <prompt> runs the same prompt in 3 new worktrees, so the best attempt can be kept.
export function parseTries(text: string): { n: number; prompt: string } | 'usage' | null {
  const m = /^\/tries\b([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const t = /^\s+([2-4])\s+(\S[\s\S]*)$/.exec(m[1]);
  return t ? { n: Number(t[1]), prompt: t[2].trim() } : 'usage';
}

// The first words of a prompt or title and the time, to name a branch.
export function branchSlug(text: string, now = new Date()) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 4).join('-') || 'try';
  return `${slug}-${now.toISOString().slice(5, 16).replace(/\D/g, '')}`;
}

export function triesBranches(prompt: string, n: number, now = new Date()) {
  const slug = branchSlug(prompt, now);
  return Array.from({ length: n }, (_, i) => `tries/${slug}-${i + 1}`);
}

// The main checkout of the repo the chat is in, also when the chat runs inside one of its worktrees.
// Cached for a minute: build records, cards and the board ask for it on every event and poll.
const checkouts = new Map<string, { at: number; repo: Promise<string> }>();
export function mainCheckout(cwd: string) {
  const hit = checkouts.get(cwd);
  if (hit && Date.now() - hit.at < 60_000) return hit.repo;
  const repo = run('git', ['-C', cwd, 'worktree', 'list', '--porcelain']).then(({ stdout }) => stdout.split('\n')[0].replace(/^worktree /, ''));
  repo.catch(() => checkouts.delete(cwd));
  checkouts.set(cwd, { at: Date.now(), repo });
  if (checkouts.size > 200) checkouts.delete(checkouts.keys().next().value!);
  return repo;
}

// A new worktree on a new branch, made by Paseo. Without Paseo it is a plain git worktree in a hidden .tries folder next to the repo, which the repo list skips.
export async function makeWorktree(repo: string, branch: string) {
  try {
    return { dir: await createWorktree(repo, branch), paseo: true };
  } catch (err) {
    if (!/not installed|not a Paseo project/.test(String(err))) throw err;
    const dir = path.join(path.dirname(repo), '.tries', `${path.basename(repo)}-${branch.split('/').pop()}`);
    const base = (await run('git', ['-C', repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => ({ stdout: 'HEAD' }))).stdout.trim();
    await run('git', ['-C', repo, 'worktree', 'add', '-b', branch, dir, base]);
    return { dir, paseo: false };
  }
}

export async function startTries(cwd: string, n: number, prompt: string, ask: (cwd: string, prompt: string) => Promise<string>) {
  const repo = await mainCheckout(cwd);
  const branches = triesBranches(prompt, n);
  const cwds = [];
  for (const b of branches) cwds.push((await makeWorktree(repo, b)).dir);
  const ids = await Promise.all(cwds.map((c) => ask(c, prompt)));
  return ids.map((id, i) => ({ id, branch: branches[i] }));
}
