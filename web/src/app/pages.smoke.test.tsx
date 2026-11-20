import { describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { stubGlobal } from '../../../testing';

const store = { runs: [] as unknown[], live: [] as unknown[], pending: [] as unknown[], events: [] as unknown[], session: { id: 'c1', cwd: '/w' }, recentFiles: [] as string[], ui: { sketch: null } };
vi.mock('../codex/data', () => ({ useAssistantStore: vi.fn(), assistantStore: vi.fn(), useAssistant: vi.fn(), useAssistantData: () => ({ jobs: [], runs: [] }), useAssistantTable: vi.fn() }));

const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
stubGlobal('document', doc);
stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('location', { search: '', hash: '' });

const realStore = await import('./store');
vi.mock('./store', () => ({ ...realStore, useStore: (select: (s: unknown) => unknown) => select(store) }));

const { RailHead } = await import('../sessions/brief/RailHead');
const { GoalsBlock } = await import('../codex/overview/GoalsBlock');
const { GoalField } = await import('../codex/tasks/Goals');
const { weekStart } = await import('../codex/data/dates');
const { PrivacyGroup } = await import('./shell/Settings');
const { SketchFrame, SketchList, Sketches } = await import('../workspace/Sketches');

describe('page smoke', () => {
  it('the rail head of a job run waiting for review is its review card', () => {
    store.runs = [{ id: 'r1', kind: 'job', sessionId: 's', chatId: 'c1', title: 'Fix the parser', what: '', startedAt: 1, endedAt: null, state: 'paused', why: '', round: 1, max: 1, nextAt: null, costUsd: 0, needsYou: true, branch: 'job/fix-parser', review: 'pending', rounds: [] }];
    const html = renderToStaticMarkup(<RailHead />);
    expect(html).toContain('Commit, push and open a PR');
  });

  it('the Overview goals block shows a goal with its progress and nothing without goals', () => {
    const row = (o: object) => ({ profile: 'work', deleted: 0, ...o }) as never;
    const items = [row({ id: 'g', title: 'Ship it', status: 'goal', at: weekStart(Date.now()) }), row({ id: 'a', status: 'done', goal: 'g' }), row({ id: 'b', status: 'open', goal: 'g' })];
    const html = renderToStaticMarkup(<GoalsBlock items={items} meetings={[]} filter="work" now={Date.now()} />);
    expect(html).toContain('Goals this week');
    expect(html).toContain('Ship it');
    expect(html).toContain('1/2 done');
    expect(renderToStaticMarkup(<GoalsBlock items={[]} meetings={[]} filter="all" now={Date.now()} />)).toBe('');
  });

  it('the goal field shows the profile chips under All and hides at the goal limit', () => {
    const state = (goals: unknown[], pick?: () => void) => ({ goals, profile: 'work', pick, text: '', setText: () => {}, add: async () => {} }) as never;
    const open = renderToStaticMarkup(<GoalField {...state([], () => {})} />);
    expect(open).toContain('Add a goal for this week');
    expect(open).toContain('Personal');
    expect(renderToStaticMarkup(<GoalField {...state([])} />)).not.toContain('Personal');
    expect(renderToStaticMarkup(<GoalField {...state([1, 2, 3], () => {})} />)).toBe('');
  });

  it('Sketches renders on an empty store', () => {
    expect(renderToStaticMarkup(<Sketches shown />)).toContain('skeleton-list');
  });

  it('Sketches folds to 5 rows with Show all', () => {
    const list = [1, 2, 3, 4, 5, 6].map((n) => ({ name: `s${n}.html`, path: `.claude/sketches/s${n}.html`, mtime: Date.now() }));
    const html = renderToStaticMarkup(<SketchList sketches={list} onOpen={() => {}} />);
    expect(html.match(/class="ui-row[ "]/g)).toHaveLength(5);
    expect(html).toContain('Show all 6');
  });

  it('the sketch frame has an empty sandbox and a srcdoc with the policy', () => {
    const html = renderToStaticMarkup(<SketchFrame name="login.html" html="<h1>Login</h1><script>fetch('/api/state')</script>" device="phone" theme="dark" />);
    expect(html).toContain('<iframe sandbox=""');
    expect(html).not.toContain('allow-');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('data-theme=&quot;dark&quot;');
  });

  it('Settings shows Privacy with the Feature use row while analytics are on or a feature is hidden', () => {
    const group = (on: boolean, anyHidden = false) => renderToStaticMarkup(<PrivacyGroup on={on} anyHidden={anyHidden} onToggle={() => {}} onOpen={() => {}} onInfo={() => {}} />);
    expect(group(false)).toContain('Privacy');
    expect(group(false)).toContain('Off');
    expect(group(false)).not.toContain('Feature use');
    expect(group(true)).toContain('On');
    expect(group(true)).toContain('Feature use');
    expect(group(false, true)).toContain('Feature use');
  });
});
