import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[][] = [];
const pr = (number: number, updatedAt = '2026-10-23T10:00:00Z') => ({ number, title: `PR ${number}`, author: { login: 'me' }, headRefName: 'b', isDraft: false, reviewDecision: '', statusCheckRollup: [], updatedAt, url: '', additions: 1, deletions: 0 });
let listed = [pr(1), pr(2)];

vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: null, out: { stdout: string; stderr: string }) => void) => {
    calls.push(args);
    const out = args[1] === 'list' ? (args.includes('user-review-requested:@me') ? [listed[0]] : listed) : args[1] === 'view' ? { body: 'b', reviews: [], comments: [], files: [], commits: [], statusCheckRollup: [] } : 'diff --git a/x b/x';
    cb(null, { stdout: typeof out === 'string' ? out : JSON.stringify(out), stderr: '' });
  },
}));

const { github, listPrs } = await import('./github.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
const listCalls = () => calls.filter((a) => a[1] === 'list').length;
const viewCalls = () => calls.filter((a) => a[1] === 'view').length;

describe('listPrs', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.useRealTimers();
  });

  it('serves the last list at once and refreshes behind it when old', async () => {
    const cwd = `/repo-${Math.random()}`;
    const first = await listPrs(cwd);
    expect(first.map((p) => p.number)).toEqual([1, 2]);
    expect(listCalls()).toBe(3);
    await listPrs(cwd);
    expect(listCalls()).toBe(3);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    listed = [pr(3), pr(1), pr(2)];
    const stale = await listPrs(cwd);
    expect(stale.map((p) => p.number)).toEqual([1, 2]);
    await tick();
    expect(listCalls()).toBe(6);
    expect((await listPrs(cwd)).map((p) => p.number)).toEqual([3, 1, 2]);
    vi.restoreAllMocks();
  });

  it('shares one refresh between callers and caches detail by updatedAt', async () => {
    const cwd = `/repo-${Math.random()}`;
    await Promise.all([listPrs(cwd, true), listPrs(cwd, true)]);
    expect(listCalls()).toBe(3);
    await tick();
    const prefetched = viewCalls();
    expect(prefetched).toBe(1);
    const url = new URL(`http://x/api/gh/pr/${listed[0].number}`);
    await github(cwd, 'GET', url, async () => '');
    expect(viewCalls()).toBe(prefetched);
    listed = listed.map((p) => (p.number === listed[0].number ? { ...p, updatedAt: '2026-10-23T11:00:00Z' } : p));
    await listPrs(cwd, true);
    await tick();
    expect(viewCalls()).toBe(prefetched + 1);
  });
});
