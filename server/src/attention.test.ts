import { describe, expect, it, vi } from 'vitest';
import { commitItem, deployItems, dismissAttention, fixCi, itemsFor, merge, sentryItems } from './attention.js';

vi.mock('node:fs/promises', async (orig) => ({ ...(await orig<typeof import('node:fs/promises')>()), writeFile: vi.fn(async () => {}) }));
import type { PullRequest } from '../../shared/protocol.js';

const pr = (n: number, p: Partial<PullRequest> = {}): PullRequest => ({
  number: n, title: `PR ${n}`, author: 'me', branch: `b${n}`, draft: false, review: '', checks: 'success',
  updatedAt: '', url: `https://github.com/o/r/pull/${n}`, sha: `sha${n}`, additions: 0, deletions: 0, mine: true, reviewRequested: false, ...p,
});

describe('itemsFor', () => {
  it('flags my failing, reviewed and approved PRs, review requests and assigned issues', () => {
    const items = itemsFor('/w/r', [
      pr(1, { checks: 'failure' }),
      pr(2, { review: 'CHANGES_REQUESTED' }),
      pr(3, { mine: false, reviewRequested: true }),
      pr(4, { review: 'APPROVED' }),
      pr(5, { review: 'APPROVED', draft: true }),
      pr(6, { checks: 'pending' }),
    ], [{ number: 9, title: 'Bug', url: 'https://github.com/o/r/issues/9', updatedAt: '' }]);
    expect(items.map((i) => `${i.kind}:${i.number}`)).toEqual(['ci:1', 'changes:2', 'review:3', 'ready:4', 'issue:9']);
    expect(items[0].repo).toBe('r');
    expect(items[0].prompt).toContain('gh pr checks 1');
    expect(items[0].prompt).toContain('branch b1');
  });
});

describe('merge', () => {
  it('reports only new items and keeps the first-seen time', () => {
    const a = itemsFor('/w/r', [pr(1, { checks: 'failure' })], [], 100);
    expect(merge(a, 100).map((i) => i.id)).toEqual(['ci:https://github.com/o/r/pull/1']);
    const b = itemsFor('/w/r', [pr(1, { checks: 'failure' }), pr(2, { checks: 'failure' })], [], 200);
    const fresh = merge(b, 200);
    expect(fresh.map((i) => i.number)).toEqual([2]);
    expect(b.find((i) => i.number === 1)?.since).toBe(100);
  });

  it('alerts again when an item disappears for a week and comes back', () => {
    const one = () => itemsFor('/w/r', [pr(7, { checks: 'failure' })], []);
    merge(one(), 0);
    merge([], 8 * 24 * 60 * 60_000);
    expect(merge(one(), 8 * 24 * 60 * 60_000 + 1)).toHaveLength(1);
  });
});

describe('commitItem', () => {
  const status = (n: number) => ({ branch: 'main', ahead: 0, behind: 0, files: Array.from({ length: n }, (_, i) => ({ path: `f${i}`, status: 'M' as const, staged: false })) });
  const edited = { cwd: '/w/r', chatId: 'c1', at: 0 };

  it('nudges about changes left by an idle chat', () => {
    const it = commitItem(edited, status(2), 11 * 60_000);
    expect(it?.kind).toBe('commit');
    expect(it?.title).toBe('2 changed files on main');
    expect(it?.chatId).toBe('c1');
    expect(it?.prompt).toContain('Do not commit until I confirm');
  });

  it('stays quiet while the chat is recent or the tree is clean', () => {
    expect(commitItem(edited, status(2), 5 * 60_000)).toBeNull();
    expect(commitItem(edited, status(0), 11 * 60_000)).toBeNull();
  });
});

describe('sentryItems', () => {
  const issue = (id: string, count: number) => ({ id, shortId: `APP-${id}`, title: `Boom ${id}`, culprit: '', count, userCount: 1, lastSeen: '', permalink: `https://s/${id}`, level: 'error' });

  it('records the backlog on the first poll without flagging it', () => {
    const r = sentryItems('/w/r', 'r', [issue('1', 5)], undefined, 1000);
    expect(r.items).toEqual([]);
    expect(r.base).toEqual({ '1': { count: 5, at: 0 } });
  });

  it('flags new issues for a day and spikes that doubled by 20 or more', () => {
    const base = { '1': { count: 5, at: 0 }, '2': { count: 30, at: 0 } };
    const r = sentryItems('/w/r', 'r', [issue('1', 9), issue('2', 61), issue('3', 1)], base, 1000);
    expect(r.items.map((i) => i.id)).toEqual(['sentry:2:spike', 'sentry:3:new']);
    expect(r.items[1].title).toBe('APP-3 Boom 3 (new, 1 event)');
    const later = sentryItems('/w/r', 'r', [issue('3', 2)], r.base, 1000 + 25 * 60 * 60_000);
    expect(later.items).toEqual([]);
  });
});

describe('stale and deploy items', () => {
  const day = 24 * 60 * 60_000;

  it('flags my unreviewed PRs with no activity for over two days', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    const items = itemsFor('/w/r', [
      pr(1, { updatedAt: new Date(now - 3 * day).toISOString() }),
      pr(2, { updatedAt: new Date(now - 1 * day).toISOString() }),
      pr(3, { updatedAt: new Date(now - 3 * day).toISOString(), review: 'APPROVED' }),
      pr(4, { updatedAt: new Date(now - 3 * day).toISOString(), draft: true }),
    ], [], now);
    expect(items.filter((i) => i.kind === 'stale').map((i) => i.number)).toEqual([1]);
  });

  it('flags environments whose newest deployment failed', () => {
    const rec = (id: number, state: string) => ({ id, sha: 'abcdef1234', ref: 'main', state, description: state === 'failure' ? 'Build failed' : '', at: '', by: 'me', url: `https://v/${id}` });
    const env = (label: string, latest: ReturnType<typeof rec>) => ({ name: `app/${label}`, label, defaultBranchOnly: false, deployed: null, latest, rollbackTo: rec(1, 'success'), history: [latest] });
    const status = { apps: ['app'], app: 'app', repo: 'o/r', velodrome: '', head: { sha: '', branch: '' }, envs: [env('prod', rec(3, 'failure')), env('staging', rec(4, 'pending')), env('dev', rec(5, 'success'))] };
    const items = deployItems('/w/r', status, 0);
    expect(items.map((i) => i.title)).toEqual(['prod: Build failed (abcdef1)']);
    expect(items[0].prompt).toContain('roll back to abcdef1');
  });
});

describe('dismissals', () => {
  it('survive a poll that misses the item and end when it has been gone for a week', () => {
    const day = 24 * 60 * 60_000;
    const item = () => itemsFor('/w/r', [pr(9, { checks: 'failure' })], []);
    const id = item()[0].id;
    expect(merge(item(), 0).map((i) => i.id)).toContain(id);
    dismissAttention(id);
    merge([], day);
    merge(item(), 2 * day);
    expect(merge(item(), 2 * day).map((i) => i.id)).not.toContain(id);
    merge([], 10 * day);
    expect(merge(item(), 10 * day).map((i) => i.id)).toContain(id);
  });
});

describe('fixCi', () => {
  it('starts one fix chat per failing head commit on listed repos', async () => {
    const fix = vi.fn(async (it: { number: number }) => `chat${it.number}`);
    const started = new Map<string, string>();
    const items = () => itemsFor('/w/r', [pr(1, { checks: 'failure' }), pr(2, { checks: 'failure', review: 'CHANGES_REQUESTED' })], []);
    const first = items();
    await fixCi(first, ['r'], fix, started);
    expect(fix.mock.calls.map((c) => c[0].id)).toEqual(['ci:https://github.com/o/r/pull/1', 'ci:https://github.com/o/r/pull/2']);
    expect(first.map((i) => i.fixing)).toEqual(['chat1', 'chat2', undefined]);
    const again = items();
    await fixCi(again, ['r'], fix, started);
    expect(fix).toHaveBeenCalledTimes(2);
    expect(again[0].fixing).toBe('chat1');
    const pushed = itemsFor('/w/r', [pr(1, { checks: 'failure', sha: 'sha1b' })], []);
    await fixCi(pushed, ['r'], fix, started);
    expect(fix).toHaveBeenCalledTimes(3);
  });

  it('leaves other repos and failed starts alone', async () => {
    const fix = vi.fn(async () => { throw new Error('no'); });
    const started = new Map<string, string>();
    const other = itemsFor('/w/r', [pr(3, { checks: 'failure' })], []);
    await fixCi(other, ['x'], fix, started);
    expect(fix).not.toHaveBeenCalled();
    await fixCi(other, ['r'], fix, started);
    await fixCi(other, ['r'], fix, started);
    expect(fix).toHaveBeenCalledTimes(1);
    expect(other[0].fixing).toBeUndefined();
  });
});
