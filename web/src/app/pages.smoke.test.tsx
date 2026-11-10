import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildList } from '../sessions/Builds';
import { Runs } from '../sessions/Runs';
import type { BuildRow } from '../../../shared/builds';
import type { ChatRun } from '../../../shared/protocol';

const store = vi.hoisted(() => ({ runs: [] as unknown[] }));
vi.mock('./store', async (orig) => ({ ...(await orig<object>()), useStore: (select: (s: unknown) => unknown) => select(store) }));
vi.mock('../codex/data', () => ({ useAssistantData: () => ({ jobs: [], runs: [] }) }));

vi.hoisted(() => {
  const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('location', { search: '', hash: '' });
});

const pending = { id: 'r1', kind: 'job', sessionId: 's', chatId: 'c', title: 'Fix the parser', what: '', startedAt: 1, endedAt: null, state: 'paused', why: '', round: 1, max: 1, nextAt: null, costUsd: 0, needsYou: true, branch: 'job/fix-parser', review: 'pending', rounds: [] } as ChatRun;

const build ={ slug: 'sample-spec', title: 'Sample spec', stage: 'test', state: 'failed', conclusion: 'Tests failed · 1 of 3 criteria', updatedAt: Date.now(), pipeline: 'implemented', draft: false } as BuildRow;

describe('page smoke', () => {
  it('Builds shows the empty state with no builds', () => {
    const html = renderToStaticMarkup(<BuildList builds={[]} onOpen={() => {}} expanded={[]} onExpand={() => {}} />);
    expect(html.match(/class="ui-empty /g)).toHaveLength(1);
    expect(html).toContain('No builds yet');
  });

  it('Runs shows To review with a card for a pending run on an empty store', () => {
    store.runs = [pending];
    const html = renderToStaticMarkup(<Runs />);
    expect(html).toContain('To review');
    expect(html).toContain('1</span>');
    expect(html).toContain('Commit, push and open a PR');
    expect(html).not.toContain('ui-empty');
  });

  it('Builds shows a row with its dot and conclusion', () => {
    const html = renderToStaticMarkup(<BuildList builds={[build]} onOpen={() => {}} expanded={[]} onExpand={() => {}} />);
    expect(html).toContain('dot bad');
    expect(html).toContain('Implemented · Tests failed · 1 of 3 criteria');
    expect(html).toContain('Active');
    expect(html).not.toContain('ui-empty');
  });

  it('Builds folds drafts to 3 rows with Show all until the group is expanded', () => {
    const drafts = [1, 2, 3, 4, 5].map((n) => ({ ...build, slug: `d${n}`, draft: true, pipeline: 'written', conclusion: 'Not started' }) as BuildRow);
    const folded = renderToStaticMarkup(<BuildList builds={drafts} onOpen={() => {}} expanded={[]} onExpand={() => {}} />);
    expect(folded.match(/class="ui-row[ "]/g)).toHaveLength(3);
    expect(folded).toContain('Show all 5');
    const open = renderToStaticMarkup(<BuildList builds={drafts} onOpen={() => {}} expanded={['drafts']} onExpand={() => {}} />);
    expect(open.match(/class="ui-row[ "]/g)).toHaveLength(5);
    expect(open).not.toContain('Show all');
  });
});
