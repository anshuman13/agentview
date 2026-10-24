import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gitRoute, parseStatus } from './git.js';

const repo = mkdtempSync(path.join(os.tmpdir(), 'agentview-git-'));
const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo });
sh('init', '-q', '-b', 'main');
sh('config', 'user.email', 't@t');
sh('config', 'user.name', 't');
writeFileSync(path.join(repo, 'a.txt'), 'a\n');
writeFileSync(path.join(repo, 'gone.txt'), 'g\n');
sh('add', '.');
sh('commit', '-q', '-m', 'init');
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const route = (r: string, body: Record<string, unknown> | null = null, q = '') => gitRoute(repo, r, new URLSearchParams(q), body);
const status = () => route('status') as ReturnType<typeof parseStatus>;

describe('parseStatus', () => {
  it('reads branch, ahead/behind, renames and both index and worktree changes', () => {
    const out = ['# branch.oid abc', '# branch.head main', '# branch.ab +2 -1', '1 MM N... 100644 100644 100644 a b src/x y.ts', '2 R. N... 100644 100644 100644 a b R100 new.ts', 'old.ts', '? src/new.ts', ''].join('\0');
    expect(parseStatus(out, 'src/')).toEqual({ branch: 'main', ahead: 2, behind: 1, files: [{ path: 'x y.ts', status: 'M', staged: true }, { path: 'x y.ts', status: 'M', staged: false }, { path: 'new.ts', status: '?', staged: false }] });
  });
});

describe('gitRoute', () => {
  it('stages, unstages, diffs, discards and commits', async () => {
    writeFileSync(path.join(repo, 'a.txt'), 'b\n');
    rmSync(path.join(repo, 'gone.txt'));
    mkdirSync(path.join(repo, 'd'));
    writeFileSync(path.join(repo, 'd/new.txt'), 'n\n');
    expect((await status()).files).toEqual([
      { path: 'a.txt', status: 'M', staged: false },
      { path: 'gone.txt', status: 'D', staged: false },
      { path: 'd/new.txt', status: '?', staged: false },
    ]);
    expect(((await route('diff', null, 'path=d/new.txt')) as { diff: string }).diff).toContain('+n');
    await route('stage', { paths: ['a.txt', 'gone.txt'] });
    expect(((await route('diff', null, 'path=a.txt&staged=true')) as { diff: string }).diff).toContain('+b');
    await route('unstage', { paths: ['gone.txt'] });
    expect((await status()).files.filter((f) => f.staged)).toEqual([{ path: 'a.txt', status: 'M', staged: true }]);
    await route('discard', { paths: ['gone.txt', 'd/new.txt'] });
    expect(existsSync(path.join(repo, 'd/new.txt'))).toBe(false);
    expect(readFileSync(path.join(repo, 'gone.txt'), 'utf8')).toBe('g\n');
    await route('commit', { message: 'change a' });
    expect((await status()).files).toEqual([]);
  });

  it('rejects paths outside the folder and mutations without a body', async () => {
    await expect(route('stage', { paths: ['../x'] })).rejects.toThrow('outside');
    await expect(route('stage')).rejects.toThrow('POST');
    await expect(route('commit', { message: ' ' })).rejects.toThrow('empty');
  });
});
