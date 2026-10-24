import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { safeResolve } from './files.js';
import type { GitFile, GitStatus } from '../../../shared/protocol.js';

const exec = promisify(execFile);

async function git(cwd: string, args: string[], ok = [0]) {
  try {
    // Long enough for a signing prompt or a slow hook, short enough that a request never hangs for good.
    return (await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 })).stdout;
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message: string };
    if (ok.includes(e.code ?? -1)) return e.stdout ?? '';
    throw new Error(e.stderr?.trim() || e.message);
  }
}

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

export async function gitRoute(cwd: string, route: string, query: URLSearchParams, body: Record<string, unknown> | null) {
  if (route === 'status') return gitStatus(cwd);
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
  else if (route === 'discard') await discard(cwd, paths);
  else throw new Error(`Unknown git action: ${route}`);
  return { ok: true };
}
