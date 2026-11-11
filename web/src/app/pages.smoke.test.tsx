import { describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { stubGlobal } from '../../../testing';
import type { ChatRun } from '../../../shared/protocol';

const store = { runs: [] as unknown[], session: { id: 'c1', cwd: '/w' }, recentFiles: [] as string[], ui: { sketch: null } };
vi.mock('../codex/data', () => ({ useAssistantStore: vi.fn(), assistantStore: vi.fn(), useAssistant: vi.fn(), useAssistantData: () => ({ jobs: [], runs: [] }) }));

const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
stubGlobal('document', doc);
stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('location', { search: '', hash: '' });

const realStore = await import('./store');
vi.mock('./store', () => ({ ...realStore, useStore: (select: (s: unknown) => unknown) => select(store) }));

const { Runs } = await import('../sessions/Runs');
const { PrivacyGroup } = await import('./shell/Settings');
const { SketchFrame, SketchList, Sketches } = await import('../workspace/Sketches');

const pending = { id: 'r1', kind: 'job', sessionId: 's', chatId: 'c', title: 'Fix the parser', what: '', startedAt: 1, endedAt: null, state: 'paused', why: '', round: 1, max: 1, nextAt: null, costUsd: 0, needsYou: true, branch: 'job/fix-parser', review: 'pending', rounds: [] } as ChatRun;

describe('page smoke', () => {
  it('Runs shows To review with a card for a pending run on an empty store', () => {
    store.runs = [pending];
    const html = renderToStaticMarkup(<Runs />);
    expect(html).toContain('To review');
    expect(html).toContain('1</span>');
    expect(html).toContain('Commit, push and open a PR');
    expect(html).not.toContain('ui-empty');
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
