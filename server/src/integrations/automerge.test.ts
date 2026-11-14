import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoMergeStep, createAutoMerge } from './automerge.js';

const ok = { conclusion: 'SUCCESS', status: 'COMPLETED' };
const view = (p: Record<string, unknown> = {}) => ({ state: 'OPEN', title: 'T', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: [ok], headRefOid: 'A', ...p });

describe('autoMergeStep', () => {
  it('waits with a note until every rule passes', () => {
    const note = (p: Record<string, unknown>) => (autoMergeStep(view(p)) as { note: string }).note;
    expect(note({ isDraft: true })).toBe('Draft');
    expect(note({ mergeable: 'CONFLICTING' })).toBe('Conflict');
    expect(note({ reviewDecision: 'CHANGES_REQUESTED' })).toBe('Changes requested');
    expect(note({ reviewDecision: 'REVIEW_REQUIRED' })).toBe('Waiting for review');
    expect(note({ statusCheckRollup: [ok, { conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }] })).toContain('Checks failed');
    expect(note({ statusCheckRollup: [ok, { status: 'IN_PROGRESS' }] })).toBe('Waiting for checks');
    expect(note({ statusCheckRollup: [] })).toBe('No passing checks');
    expect(note({ statusCheckRollup: [{ conclusion: 'SKIPPED' }, { conclusion: 'NEUTRAL' }] })).toBe('No passing checks');
  });

  it('merges on one success beside skipped checks and deletes a finished PR', () => {
    expect(autoMergeStep(view({ statusCheckRollup: [ok, { conclusion: 'SKIPPED' }] }))).toEqual({ kind: 'merge', sha: 'A' });
    expect(autoMergeStep(view({ statusCheckRollup: [{ state: 'SUCCESS' }] }))).toEqual({ kind: 'merge', sha: 'A' });
    expect(autoMergeStep(view({ state: 'MERGED' }))).toEqual({ kind: 'delete' });
    expect(autoMergeStep(view({ state: 'CLOSED' }))).toEqual({ kind: 'delete' });
  });
});

function setup(handler: (args: string[]) => Promise<string> | string) {
  const calls: string[][] = [];
  const posts: string[][] = [];
  const am = createAutoMerge({
    gh: async (_cwd, ...args) => {
      calls.push(args);
      return handler(args);
    },
    post: (...p) => void posts.push(p),
    file: path.join(mkdtempSync(path.join(os.tmpdir(), 'automerge-')), 'automerge.json'),
    changed: () => {},
    exists: (cwd) => cwd !== '/gone',
  });
  return { am, calls, posts, merges: () => calls.filter((a) => a[1] === 'merge') };
}

const json = (v: unknown) => JSON.stringify(v);

describe('createAutoMerge', () => {
  it('runs no gh command without entries and never merges another PR or uses --auto', async () => {
    let rollup: unknown[] = [ok];
    const t = setup((a) => json(a[4] === 'state' ? { state: 'OPEN' } : view({ statusCheckRollup: rollup })));
    await t.am.poll();
    expect(t.calls).toEqual([]);
    await t.am.turn('/r', 12, true, 'squash');
    await t.am.poll();
    expect(t.merges()).toEqual([['pr', 'merge', '12', '--squash', '--match-head-commit', 'A']]);
    rollup = [];
    await t.am.poll();
    expect(t.calls.flat()).not.toContain('--auto');
    expect(t.calls.some((a) => a.includes('13'))).toBe(false);
  });

  it('refuses a closed PR, clears an error on Turn on, and treats repeats as no-ops', async () => {
    let state = 'CLOSED';
    let mergeFails = true;
    const t = setup((a) => {
      if (a[4] === 'state') return json({ state });
      if (a[1] === 'merge' && mergeFails) throw new Error('nope\nmore');
      return json(view());
    });
    await expect(t.am.turn('/r', 1, true, 'squash')).rejects.toThrow('This pull request is not open');
    expect((await t.am.state('/r')).size).toBe(0);
    state = 'OPEN';
    await t.am.turn('/r', 1, true, 'rebase');
    await t.am.poll();
    expect((await t.am.state('/r')).get(1)).toEqual({ note: 'Waiting for checks', error: 'nope' });
    expect(t.posts).toEqual([['Auto-merge failed in r', '#1', 'nope']]);
    await t.am.poll();
    expect(t.merges().length).toBe(1);
    mergeFails = false;
    await t.am.turn('/r', 1, true, 'squash');
    expect((await t.am.state('/r')).get(1)).toEqual({ note: 'Waiting for checks' });
    await t.am.poll();
    expect(t.merges().map((a) => a[3])).toEqual(['--rebase', '--squash']);
    const before = t.calls.length;
    await t.am.turn('/r', 2, true, 'squash');
    await t.am.turn('/r', 2, true, 'squash');
    expect(t.calls.length).toBe(before + 1);
    await expect(t.am.turn('/r', 3, false, 'squash')).resolves.toEqual({ ok: true });
  });

  it('merges the new head after a fix and a re-run on the same head', async () => {
    let head = { rollup: [{ conclusion: 'FAILURE' }] as unknown[], sha: 'A' };
    const t = setup((a) => json(a[4] === 'state' ? { state: 'OPEN' } : view({ statusCheckRollup: head.rollup, headRefOid: head.sha })));
    await t.am.turn('/r', 5, true, 'squash');
    await t.am.poll();
    expect(t.merges()).toEqual([]);
    head = { rollup: [ok], sha: 'B' };
    await t.am.poll();
    expect(t.merges().map((a) => a[5])).toEqual(['B']);
    expect(t.posts).toEqual([['Merged in r', '#5', 'T']]);
    await t.am.poll();
    expect(t.merges().length).toBe(1);

    head = { rollup: [{ conclusion: 'FAILURE' }], sha: 'A' };
    await t.am.turn('/r', 6, true, 'merge');
    await t.am.poll();
    head = { rollup: [ok], sha: 'A' };
    await t.am.poll();
    expect(t.merges().map((a) => a[5])).toEqual(['B', 'A']);
  });

  it('does not merge a PR turned off while its view was running', async () => {
    let release = () => {};
    const t = setup(async (a) => {
      if (a[4] === 'state') return json({ state: 'OPEN' });
      await new Promise<void>((r) => (release = r));
      return json(view());
    });
    await t.am.turn('/r', 8, true, 'squash');
    const polling = t.am.poll();
    await new Promise((r) => setTimeout(r, 5));
    await t.am.turn('/r', 8, false, 'squash');
    release();
    await polling;
    expect(t.merges()).toEqual([]);
    expect(t.posts).toEqual([]);
  });

  it('keeps the entry and posts nothing when gh pr view fails, and merges once for overlapping polls', async () => {
    let broken = true;
    const t = setup(async (a) => {
      if (a[4] === 'state') return json({ state: 'OPEN' });
      if (a[1] === 'view' && broken) throw new Error('network');
      await new Promise((r) => setTimeout(r, 10));
      return json(view());
    });
    await t.am.turn('/r', 7, true, 'squash');
    await t.am.poll();
    expect(t.posts).toEqual([]);
    expect((await t.am.state('/r')).has(7)).toBe(true);
    broken = false;
    await Promise.all([t.am.poll(), t.am.poll()]);
    expect(t.merges().length).toBe(1);
    expect(t.posts.length).toBe(1);
    expect((await t.am.state('/r')).size).toBe(0);
  });
});

describe('createAutoMerge cleanup', () => {
  it('drops an entry whose folder is gone, and an errored entry once its PR is merged', async () => {
    let state = 'OPEN';
    const t = setup((args) => (args[1] === 'merge' ? Promise.reject(new Error('nope')) : JSON.stringify(view({ state, statusCheckRollup: [{ state: 'SUCCESS' }] }))));
    await t.am.turn('/gone', 1, true, 'squash');
    await t.am.turn('/r', 2, true, 'squash');
    await t.am.poll();
    expect([...(await t.am.state('/gone')).keys()]).toEqual([]);
    expect((await t.am.state('/r')).get(2)?.error).toBe('nope');
    state = 'MERGED';
    await t.am.poll();
    expect([...(await t.am.state('/r')).keys()]).toEqual([]);
  });
});
