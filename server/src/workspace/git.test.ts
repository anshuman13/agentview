import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { gitRoute, gitStatus, parseStatus, parseNumstat, parseTodos } from './git.js';

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

  it('reverts staged, modified, added and untracked files to HEAD', async () => {
    writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
    await route('stage', { paths: ['a.txt'] });
    writeFileSync(path.join(repo, 'a.txt'), 'changed again\n');
    writeFileSync(path.join(repo, 'added.txt'), 'x\n');
    await route('stage', { paths: ['added.txt'] });
    writeFileSync(path.join(repo, 'loose.txt'), 'y\n');
    await route('revert', { paths: ['a.txt', 'added.txt', 'loose.txt'] });
    expect(readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('b\n');
    expect(existsSync(path.join(repo, 'added.txt'))).toBe(false);
    expect(existsSync(path.join(repo, 'loose.txt'))).toBe(false);
    expect((await status()).files).toEqual([]);
  });

  it('reverts a staged rename to the old path', async () => {
    sh('mv', 'gone.txt', 'moved.txt');
    await route('revert', { paths: ['moved.txt'] });
    expect(existsSync(path.join(repo, 'moved.txt'))).toBe(false);
    expect(readFileSync(path.join(repo, 'gone.txt'), 'utf8')).toBe('g\n');
    expect((await status()).files).toEqual([]);
  });

  it('rejects paths outside the folder and mutations without a body', async () => {
    await expect(route('stage', { paths: ['../x'] })).rejects.toThrow('outside');
    await expect(route('revert', { paths: ['../x'] })).rejects.toThrow('outside');
    await expect(route('revert', { paths: [] })).rejects.toThrow('No paths');
    await expect(route('stage')).rejects.toThrow('POST');
    await expect(route('commit', { message: ' ' })).rejects.toThrow('empty');
  });
});

describe('parseNumstat', () => {
  it('reads counts, binaries and renames', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\timg/logo.png\n0\t0\tsrc/{old => new}/b.ts\n2\t0\tdocs/x.md => docs/y.md\n')).toEqual([
      { path: 'src/a.ts', add: 3, del: 1 },
      { path: 'img/logo.png', add: 0, del: 0 },
      { path: 'src/new/b.ts', add: 0, del: 0 },
      { path: 'docs/y.md', add: 2, del: 0 },
    ]);
  });
});

describe('parseTodos', () => {
  it('reads TODO and FIXME comments and skips lock files and strings', () => {
    const out = ['src/a.ts:12:  // TODO: retry on 429', 'web/b.css:3:/* FIXME(ana) dark mode */', 'package-lock.json:9:"TODO": 1', 'x.md:1:Fix the TODOS list', 'y.py:4:# TODO', 'z.kt:7:val p = "Resolve the TODO at x"'].join('\n');
    expect(parseTodos(out)).toEqual([
      { path: 'src/a.ts', line: 12, text: 'retry on 429' },
      { path: 'web/b.css', line: 3, text: 'dark mode' },
      { path: 'y.py', line: 4, text: '' },
    ]);
  });

  it('puts Aider AI! and AI? comments first', () => {
    const out = ['a.ts:1:// TODO later', 'b.ts:5:  // make this async AI!', 'c.py:9:# AI? why retry twice', 'd.css:2:a { color: #fff } /* AI! use a token */', 'e.ts:3:const s = "AI!"', 'f.test.ts:4:// TODO in a test', 'src/test/G.kt:2:// AI! fixture'].join('\n');
    expect(parseTodos(out)).toEqual([
      { path: 'b.ts', line: 5, text: 'make this async', ai: '!' },
      { path: 'c.py', line: 9, text: 'why retry twice', ai: '?' },
      { path: 'd.css', line: 2, text: 'use a token', ai: '!' },
      { path: 'a.ts', line: 1, text: 'later' },
    ]);
  });
});

describe('gitStatus', () => {
  it('shares one next run among calls made while one runs, and that run sees later edits', async () => {
    const first = gitStatus(repo);
    writeFileSync(path.join(repo, 'later.txt'), 'x\n');
    const [second, third] = [gitStatus(repo), gitStatus(repo)];
    expect(second).toBe(third);
    expect(second).not.toBe(first);
    expect((await second).files.some((f) => f.path === 'later.txt')).toBe(true);
    await first;
    rmSync(path.join(repo, 'later.txt'));
  });
});
