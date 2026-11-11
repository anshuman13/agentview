import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { stubGlobal, unstubAllGlobals } from '../../../testing';
import type { RunDiff } from './sessionApi';
import type { ChatRun } from '../../../shared/protocol';

const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
stubGlobal('document', doc);
stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('location', { search: '', hash: '' });

const { ReviewCard, ReviewFiles } = await import('./ReviewCard');
const { RunRow } = await import('./Runs');
const { postRunApprove, postRunDiscard, postRunRevise } = await import('./sessionApi');

const run = { id: 'r1', kind: 'job', sessionId: 's', chatId: 'c', title: 'Fix the parser', what: '', startedAt: Date.now(), endedAt: null, state: 'paused', why: 'Ready for review', round: 1, max: 1, nextAt: null, costUsd: 0, needsYou: true, branch: 'job/fix-parser', review: 'pending', rounds: [{ n: 1, at: Date.now(), outcome: 'done', line: 'Patched the parser', costUsd: 0 }] } as ChatRun;
const diff: RunDiff = { base: 'main', diff: '', files: [1, 2, 3, 4, 5].map((n) => ({ path: `src/f${n}.ts`, additions: n, deletions: 0 })) };

describe('review card', () => {
  it('shows the summary row, Approve and More, and a skeleton until the diff loads', () => {
    const html = renderToStaticMarkup(<ReviewCard run={run} />);
    expect(html).toContain('Patched the parser');
    expect(html).toContain('job/fix-parser');
    expect(html).toContain('Needs you');
    expect(html).toContain('Commit, push and open a PR');
    expect(html).toContain('>Approve<');
    expect(html).toContain('aria-label="More"');
    expect(html).toContain('skeleton-list');
    expect(html).not.toContain('Revise');
  });

  it('lists the first 3 files with Show all until it is clicked', () => {
    const folded = renderToStaticMarkup(<ReviewFiles diff={diff} all={false} onAll={() => {}} />);
    expect(folded).toContain('f3.ts');
    expect(folded).not.toContain('f4.ts');
    expect(folded).toContain('Show all 5');
    const open = renderToStaticMarkup(<ReviewFiles diff={diff} all onAll={() => {}} />);
    expect(open).toContain('f5.ts');
    expect(open).not.toContain('Show all');
  });

  it('shows PR opened and one open button on a finished run with a PR', () => {
    const html = renderToStaticMarkup(<RunRow item={{ kind: 'run', run: { ...run, state: 'done', review: undefined, pr: 'https://example.com/pr/1' } }} onBoard={() => {}} />);
    expect(html).toContain('PR opened');
    expect(html.match(/aria-label="open"/g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com/pr/1"');
  });
});

describe('review requests', () => {
  afterEach(() => unstubAllGlobals());

  it('posts each decision once to its own route', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, url: 'u' }) }));
    stubGlobal('fetch', fetch);
    await postRunApprove('r 1');
    await postRunRevise('r1', 'Rename it');
    await postRunDiscard('r1');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => `${init.method} ${url.replace(/&chat=.*/, '')}`)).toEqual(['POST /api/runs/approve?run=r%201', 'POST /api/runs/revise?run=r1', 'POST /api/runs/discard?run=r1']);
    expect(calls[1][1].body).toBe('{"text":"Rename it"}');
  });
});
