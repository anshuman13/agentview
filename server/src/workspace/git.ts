import { copyFile, lstat, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeResolve } from './files.js';
import type { GitFile, GitStatus } from '../../../shared/protocol.js';
import { exec } from '../exec.js';
import { NotFound } from '../json.js';


export async function git(cwd: string, args: string[], ok = [0], env?: Record<string, string>) {
  try {
    // Long enough for a signing prompt or a slow hook, short enough that a request never hangs for good.
    return (await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 300_000, ...(env && { env: { ...process.env, ...env } }) })).stdout;
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message: string };
    if (ok.includes(e.code ?? -1)) return e.stdout ?? '';
    throw new Error(e.stderr?.trim() || e.message);
  }
}

// For a folder an agent wrote in: no hooks and no fsmonitor command from its config.
const SAFE_GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.ignoreSubmodules=all'];
export const safeGit = (cwd: string, args: string[], ok?: number[], env?: Record<string, string>) => git(cwd, [...SAFE_GIT, ...args], ok, env);

const KIND: Record<string, GitFile['status']> = { M: 'M', T: 'M', A: 'A', C: 'A', D: 'D', R: 'R' };

export function parseStatus(out: string, prefix = ''): GitStatus {
  const status: GitStatus = { branch: '', ahead: 0, behind: 0, files: [] };
  const add = (p: string, s: string, staged: boolean) => p.startsWith(prefix) && status.files.push({ path: p.slice(prefix.length), status: s === '?' ? '?' : KIND[s] ?? 'M', staged });
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    const f = line.split(' ');
    if (line.startsWith('# branch.head ')) status.branch = f[2];
    else if (line.startsWith('# branch.ab ')) [status.ahead, status.behind] = [Number(f[2]), -Number(f[3])];
    else if (f[0] === '1' || f[0] === '2') {
      const p = f.slice(f[0] === '1' ? 8 : 9).join(' ');
      if (f[0] === '2') i++;
      if (f[1][0] !== '.') add(p, f[1][0], true);
      if (f[1][1] !== '.') add(p, f[1][1], false);
    } else if (f[0] === 'u') add(f.slice(10).join(' '), 'M', false);
    else if (f[0] === '?') add(line.slice(2), '?', false);
  }
  return status;
}

export async function gitStatus(cwd: string) {
  const [out, prefix] = await Promise.all([git(cwd, ['status', '--porcelain=v2', '-b', '-z', '-uall']), git(cwd, ['rev-parse', '--show-prefix'])]);
  return parseStatus(out, prefix.trim());
}

function relPaths(cwd: string, paths: unknown) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('No paths given');
  return paths.map((p) => path.relative(cwd, safeResolve(cwd, String(p))) || '.');
}

const untracked = async (cwd: string, paths: string[]) =>
  new Set((await git(cwd, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...paths])).split('\0').filter(Boolean));

async function diff(cwd: string, file: string, staged: boolean) {
  const [p] = relPaths(cwd, [file]);
  if (!staged && (await untracked(cwd, [p])).has(p)) return git(cwd, ['diff', '--no-index', '--', '/dev/null', p], [1]);
  return git(cwd, ['diff', ...(staged ? ['--cached'] : []), '--', p]);
}

async function discard(cwd: string, paths: string[]) {
  const loose = await untracked(cwd, paths);
  const tracked = paths.filter((p) => !loose.has(p));
  if (loose.size) await git(cwd, ['clean', '-f', '-q', '--', ...loose]);
  if (tracked.length) await git(cwd, ['checkout', '-q', '--', ...tracked]);
}

async function revert(cwd: string, paths: string[]) {
  const loose = await untracked(cwd, paths);
  const inHead = new Set((await git(cwd, ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...paths], [0, 128])).split('\0').filter(Boolean));
  const tracked = paths.filter((p) => !loose.has(p) && inHead.has(p));
  const added = paths.filter((p) => !loose.has(p) && !inHead.has(p));
  if (loose.size) await git(cwd, ['clean', '-f', '-q', '--', ...loose]);
  // A staged rename's new path counts as added; its old path comes back with it.
  const renamed = added.length ? renamedFrom(await git(cwd, ['diff', '--cached', '-M', '--name-status', '-z', 'HEAD'], [0, 128])) : new Map<string, string>();
  const olds = added.flatMap((p) => renamed.get(p) ?? []);
  if (added.length) await git(cwd, ['rm', '-f', '-q', '--ignore-unmatch', '--', ...added]);
  if (tracked.length || olds.length) await git(cwd, ['checkout', '-q', 'HEAD', '--', ...tracked, ...olds]);
}

// New path to old path of each rename in `git diff --name-status -z` output.
export function renamedFrom(out: string) {
  const parts = out.split('\0');
  const map = new Map<string, string>();
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('R') || parts[i].startsWith('C')) {
      if (parts[i].startsWith('R')) map.set(parts[i + 2], parts[i + 1]);
      i += 2;
    } else if (parts[i]) i++;
  }
  return map;
}

export type BranchFile = { path: string; add: number; del: number };

// `git diff --numstat` lines; binary files count as 0 and 0, a rename keeps its new path.
export function parseNumstat(out: string): BranchFile[] {
  return out.split('\n').filter(Boolean).map((l) => {
    const [add, del, ...rest] = l.split('\t');
    const p = rest.join('\t').replace(/\{[^{}]* => ([^{}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/');
    return { path: p, add: Number(add) || 0, del: Number(del) || 0 };
  });
}

export const MAX_BRANCH_DIFF = 2_000_000;

// The default branch as a remote ref, origin/main when the repo has no origin/HEAD.
export const defaultBase = async (cwd: string, env?: Record<string, string>, fallback = 'origin/main') => (await safeGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], undefined, env).catch(() => fallback)).trim();

// The main checkout of the repo the chat is in, also when the chat runs inside one of its worktrees.
// Cached for a minute: build records, cards and the board ask for it on every event and poll.
const checkouts = new Map<string, { at: number; repo: Promise<string> }>();
export function mainCheckout(cwd: string) {
  const hit = checkouts.get(cwd);
  if (hit && Date.now() - hit.at < 60_000) return hit.repo;
  const repo = exec('git', ['-C', cwd, 'worktree', 'list', '--porcelain']).then(({ stdout }) => stdout.split('\n')[0].replace(/^worktree /, ''));
  repo.catch(() => checkouts.delete(cwd));
  checkouts.set(cwd, { at: Date.now(), repo });
  if (checkouts.size > 200) checkouts.delete(checkouts.keys().next().value!);
  return repo;
}


// What this branch committed since it left the default branch, for review before a PR.
async function branchDiff(cwd: string) {
  const base = await defaultBase(cwd);
  const since = (await git(cwd, ['merge-base', base, 'HEAD']).catch(() => '')).trim();
  const name = base.replace(/^origin\//, '');
  if (!since) return { base: name, files: [], diff: '' };
  const [numstat, diff] = await Promise.all([git(cwd, ['diff', '--numstat', since, 'HEAD']), git(cwd, ['diff', since, 'HEAD'])]);
  return { base: name, files: parseNumstat(numstat), diff: diff.length > MAX_BRANCH_DIFF ? '' : diff };
}

const mergeBase = async (cwd: string, base: string, env?: Record<string, string>) => (await safeGit(cwd, ['merge-base', base, 'HEAD'], undefined, env).catch(() => '')).trim();
const PLAIN_DIFF = ['--no-ext-diff', '--no-textconv'];
const MAX_LOOSE = 200;

// Whether a run's branch holds anything to review: files not committed, or commits past the default branch. Without a merge base it counts as work.
export async function hasWork(cwd: string, env?: Record<string, string>) {
  if ((await safeGit(cwd, ['status', '--porcelain', '--ignore-submodules=all'], undefined, env)).trim()) return true;
  const since = await mergeBase(cwd, await defaultBase(cwd, env), env);
  return !since || Number(await safeGit(cwd, ['rev-list', '--count', `${since}..HEAD`], undefined, env)) > 0;
}

// Commits and uncommitted changes against the merge base, with untracked files read through --no-index so nothing is staged.
// Untracked files join one diff as intent-to-add entries in a copy of the index, so the worktree's own index is left as it was.
async function withLoose<T>(cwd: string, loose: string[], env: Record<string, string> | undefined, fn: (env?: Record<string, string>) => Promise<T>) {
  if (!loose.length) return fn(env);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'review-'));
  try {
    const e = { ...env, GIT_INDEX_FILE: path.join(dir, 'index'), GIT_LITERAL_PATHSPECS: '1' };
    const index = path.resolve(cwd, (await safeGit(cwd, ['rev-parse', '--git-path', 'index'], undefined, env)).trim());
    await copyFile(index, e.GIT_INDEX_FILE).catch(() => {});
    await safeGit(cwd, ['add', '-N', '--', ...loose], undefined, e);
    return await fn(e);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function reviewDiff(cwd: string, env?: Record<string, string>) {
  const base = await defaultBase(cwd, env);
  const since = (await mergeBase(cwd, base, env)) || 'HEAD';
  const listed = (await safeGit(cwd, ['ls-files', '-z', '--others', '--exclude-standard'], undefined, env)).split('\0').filter(Boolean);
  // A pipe or socket would block the diff, and a nested repo is not a file.
  const loose: string[] = [];
  for (const p of listed) {
    const st = await lstat(path.join(cwd, p)).catch(() => null);
    if (st && (st.isFile() || st.isSymbolicLink())) loose.push(p);
  }
  const [files, diff] = await withLoose(cwd, loose.slice(0, MAX_LOOSE), env, (e) =>
    Promise.all([safeGit(cwd, ['diff', '--numstat', ...PLAIN_DIFF, since], undefined, e).then(parseNumstat), safeGit(cwd, ['diff', ...PLAIN_DIFF, since], undefined, e)]));
  return {
    base: base.replace(/^origin\//, ''),
    files: files.map((f) => ({ path: f.path, additions: f.add, deletions: f.del })),
    diff: diff.length > MAX_BRANCH_DIFF ? '' : diff,
  };
}

export type Todo = { path: string; line: number; text: string; ai?: '!' | '?' };

// `git grep -n` lines for TODO and FIXME comments, as tasks to hand to Claude. Lock files, minified code and tests are skipped.
// Aider-style comments that start or end with AI! (do this) or AI? (answer this) come first.
export function parseTodos(out: string, max = 100): Todo[] {
  const todos: Todo[] = [];
  const asks: Todo[] = [];
  for (const l of out.split('\n')) {
    const m = /^(.+?):(\d+):(.*)$/.exec(l);
    if (!m || m[3].length > 400 || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock)$|\.min\.|\.test\.|Test\.kt$|(^|\/)(test|tests|__tests__)\//.test(m[1])) continue;
    const ai = /(?:\/\/|#|\/\*|<!--|^\s*\*|--)\s*(?:AI([!?])\s*(.*?)|(.*?)\s*\bAI([!?]))\s*(?:\*\/|-->)?\s*$/.exec(m[3]);
    if (ai) {
      asks.push({ path: m[1], line: Number(m[2]), text: (ai[2] ?? ai[3]).trim(), ai: (ai[1] ?? ai[4]) as '!' | '?' });
      continue;
    }
    const text = /(?:\/\/|#|\/\*|<!--|^\s*\*|--)\s*(?:TODO|FIXME)\b(?:\([^)]*\))?[:\s]*(.*)$/.exec(m[3])?.[1]?.replace(/\s*(\*\/|-->)\s*$/, '').trim();
    if (text !== undefined) todos.push({ path: m[1], line: Number(m[2]), text });
  }
  return [...asks, ...todos].slice(0, max);
}

export async function gitRoute(cwd: string, route: string, query: URLSearchParams, body: Record<string, unknown> | null) {
  if (route === 'status') return gitStatus(cwd);
  if (route === 'branch') return branchDiff(cwd);
  if (route === 'todos') return { todos: parseTodos(await git(cwd, ['grep', '-n', '-I', '-w', '-E', 'TODO|FIXME|AI[!?]'], [0, 1])) };
  if (route === 'diff') return { diff: await diff(cwd, query.get('path') ?? '', query.get('staged') === 'true') };
  if (!body) throw new Error('Use POST');
  if (route === 'commit') {
    const message = String(body.message ?? '');
    if (!message.trim()) throw new Error('Commit message is empty');
    await git(cwd, ['commit', '-q', '-m', message]);
    return { ok: true };
  }
  const paths = relPaths(cwd, body.paths);
  if (route === 'stage') await git(cwd, ['add', '-A', '--', ...paths]);
  else if (route === 'unstage') await git(cwd, ['reset', '-q', '--', ...paths]);
  else if (route === 'revert') await revert(cwd, paths);
  else if (route === 'discard') await discard(cwd, paths);
  else throw new NotFound(`Unknown git action: ${route}`);
  return { ok: true };
}
