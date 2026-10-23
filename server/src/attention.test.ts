import { describe, expect, it } from 'vitest';
import { commitItem, itemsFor, merge } from './attention.js';
import type { PullRequest } from '../../shared/protocol.js';

const pr = (n: number, p: Partial<PullRequest> = {}): PullRequest => ({
  number: n, title: `PR ${n}`, author: 'me', branch: `b${n}`, draft: false, review: '', checks: 'success',
  updatedAt: '', url: `https://github.com/o/r/pull/${n}`, additions: 0, deletions: 0, mine: true, reviewRequested: false, ...p,
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
