import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRun } from '../../../shared/protocol.js';

const mocks = vi.hoisted(() => ({ calls: [] as string[][], gh: vi.fn(), remote: { head: '' }, removeChat: vi.fn() }));

// git runs for real in temp repos, except push and ls-remote; gh never runs.
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const run = (real.execFile as unknown as Record<symbol, (...a: unknown[]) => Promise<unknown>>)[promisify.custom];
  const execFile = Object.assign((...a: unknown[]) => (real.execFile as (...a: unknown[]) => unknown)(...a), {
    [promisify.custom]: async (cmd: string, args: string[], opts: unknown) => {
      mocks.calls.push([cmd, ...args]);
      if (cmd === 'gh') return mocks.gh(args);
      if (args.includes('push')) return { stdout: '' };
      if (args.includes('ls-remote')) return { stdout: mocks.remote.head ? `${mocks.remote.head}\trefs/heads/x\n` : '' };
      return run(cmd, args, opts);
    },
  });
  return { ...real, execFile };
});
vi.mock('../agent/claude/pins.js', () => ({ removeChat: mocks.removeChat }));

import { jobRepo, sh } from '../workspace/testRepo.js';
import type { RouteDeps } from './routeTypes.js';
import { runRoutes } from './runRoutes.js';

const gitCalls = () => mocks.calls.filter((c) => c[0] === 'git');
const calling = (word: string) => gitCalls().filter((c) => c.includes(word));
const noPr = () => Object.assign(new Error('x'), { stderr: 'no pull requests found for branch "jobs/test-1"' });

let fixture: ReturnType<typeof jobRepo>;
let run: ChatRun;
let req: ReturnType<typeof vi.fn>;
let routes: ReturnType<typeof runRoutes>;

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.remote.head = '';
  vi.clearAllMocks();
  fixture = jobRepo();
  run = fixture.run;
  req = vi.fn(async (r: { op: string; why?: string; pr?: string }) => {
    if (r.op === 'run_end') Object.assign(run, { state: 'done', review: undefined, why: r.why, pr: r.pr });
  });
  routes = runRoutes({ runs: () => [run], host: { req }, bySession: () => undefined, closeByUser: vi.fn() } as unknown as RouteDeps);
});
afterEach(() => rmSync(fixture.root, { recursive: true, force: true }));

const call = async (route: string, id = 'r1', body: unknown = null) => {
  const out = (await routes[route].run({ url: new URL(`http://x/api?run=${id}`), body } as never)) as { status?: number; body: unknown } | Record<string, unknown>;
  return 'status' in out ? out : { status: 200, body: out };
};
const approve = () => call('POST /api/runs/approve');

describe('git safety', () => {
  const routesList = ['GET /api/runs/diff', 'POST /api/runs/approve', 'POST /api/runs/discard'];

  it.each(['.git points elsewhere', 'HEAD on another branch'])('answers 409 and runs no git when %s', async (what) => {
    if (what === '.git points elsewhere') writeFileSync(path.join(fixture.dir, '.git'), `gitdir: ${fixture.root}/elsewhere\n`);
    else sh(fixture.dir, 'checkout', '-q', '-b', 'other');
    for (const route of routesList) expect(await call(route)).toEqual({ status: 409, body: { error: 'The worktree was changed' } });
    expect(gitCalls()).toEqual([]);
    expect(run.state).toBe('paused');
  });

  it('passes both -c flags on every git command', async () => {
    writeFileSync(path.join(fixture.dir, 'a.txt'), 'a\n');
    mocks.gh.mockRejectedValueOnce(noPr()).mockResolvedValueOnce({ stdout: 'https://example.test/pr/1\n' });
    await call('GET /api/runs/diff');
    await approve();
    expect(gitCalls().length).toBeGreaterThan(5);
    for (const c of gitCalls()) expect(c.slice(1, 5)).toEqual(['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false']);
  });
});

describe('diff', () => {
  it('covers a commit and an untracked file without staging, and 404s an unknown run', async () => {
    writeFileSync(path.join(fixture.dir, 'c.txt'), 'committed\n');
    sh(fixture.dir, 'add', 'c.txt');
    sh(fixture.dir, 'commit', '-q', '-m', 'c');
    writeFileSync(path.join(fixture.dir, 'u.txt'), 'untracked\nlines\n');
    const before = [sh(fixture.dir, 'ls-files', '-s'), sh(fixture.dir, 'status', '--porcelain')];
    const r = await call('GET /api/runs/diff');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ base: 'main', branch: fixture.branch, files: [{ path: 'c.txt', additions: 1, deletions: 0 }, { path: 'u.txt', additions: 2, deletions: 0 }] });
    expect((r.body as { diff: string }).diff).toMatch(/\+committed[\s\S]*\+untracked/);
    expect([sh(fixture.dir, 'ls-files', '-s'), sh(fixture.dir, 'status', '--porcelain')]).toEqual(before);
    expect((await call('GET /api/runs/diff', 'nope')).status).toBe(404);
  });
});

describe('approve', () => {
  it('commits with --no-verify, pushes the branch without force, opens a PR, and a second call gets 409', async () => {
    writeFileSync(path.join(fixture.dir, 'a.txt'), 'a\n');
    run.rounds = [{ n: 1, outcome: 'progress', line: 'Fixed it', costUsd: 0, at: 0 }];
    mocks.gh.mockRejectedValueOnce(noPr()).mockResolvedValueOnce({ stdout: 'https://example.test/pr/1\n' });
    expect(await approve()).toEqual({ status: 200, body: { url: 'https://example.test/pr/1' } });
    expect(sh(fixture.dir, 'log', '-1', '--format=%s')).toBe('Fixed it\n');
    expect(calling('commit')[0]).toContain('--no-verify');
    const push = calling('push');
    expect(push).toHaveLength(1);
    expect(push[0].slice(5)).toEqual(['push', '-u', 'origin', `refs/heads/${fixture.branch}`]);
    expect(mocks.gh.mock.calls[1][0]).toEqual(expect.arrayContaining(['pr', 'create', '--body', 'Opened from the scheduled job Fix the test.']));
    expect(req).toHaveBeenCalledWith({ op: 'run_end', id: 'r1', why: 'PR opened', pr: 'https://example.test/pr/1' });
    expect((await approve()).status).toBe(409);
  });

  it('stays pending when gh fails, and the retry neither commits nor pushes again and finds the PR', async () => {
    writeFileSync(path.join(fixture.dir, 'a.txt'), 'a\n');
    mocks.gh.mockRejectedValueOnce(noPr()).mockRejectedValueOnce(new Error('network down\nmore'));
    expect(await approve()).toEqual({ status: 500, body: { error: 'network down' } });
    expect(run.review).toBe('pending');
    mocks.remote.head = sh(fixture.dir, 'rev-parse', 'HEAD').trim();
    mocks.gh.mockResolvedValueOnce({ stdout: JSON.stringify({ url: 'https://example.test/pr/2' }) });
    expect(await approve()).toEqual({ status: 200, body: { url: 'https://example.test/pr/2' } });
    expect([calling('commit').length, calling('push').length]).toEqual([1, 1]);
  });
});

describe('revise and discard', () => {
  it('sends the note to the run, and a blank note gets 400', async () => {
    expect((await call('POST /api/runs/revise', 'r1', { text: '  ' })).status).toBe(400);
    expect(await call('POST /api/runs/revise', 'r1', { text: ' use a map ' })).toEqual({ status: 200, body: { ok: true } });
    expect(req).toHaveBeenCalledWith({ op: 'run_revise', id: 'r1', text: 'use a map' });
  });

  it('removes the worktree and branch, archives the chat, and a repeat gets 409', async () => {
    expect(await call('POST /api/runs/discard')).toEqual({ status: 200, body: { ok: true } });
    expect(req).toHaveBeenCalledWith({ op: 'run_end', id: 'r1', why: 'Discarded' });
    expect(mocks.removeChat).toHaveBeenCalledWith('s1', false, true);
    expect(existsSync(fixture.dir)).toBe(false);
    expect(sh(fixture.repo, 'branch', '--list', fixture.branch)).toBe('');
    expect((await call('POST /api/runs/discard')).status).toBe(409);
  });
});
