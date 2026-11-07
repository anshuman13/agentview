import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { Assistant } from '../codex/Codex';
import { Overview } from '../codex/Overview';
import { Meetings } from '../codex/meetings/Meetings';
import { sharedSplit } from '../codex/split';
import { setView } from '../codex/view';
import { DesignPage } from '../design/Stories';
import { Settings } from './Settings';

vi.hoisted(() => {
  const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('location', { search: '', hash: '' });
});

const empty = vi.hoisted(() => ({ items: [], meetings: [], jobs: [], runs: [], pages: [], facts: [], actions: [], chats: [], briefs: [], phase: 'ready', message: '' }));

vi.mock('../codex/data', () => ({
  useAssistant: () => ({ store: {}, snap: empty }),
  useAssistantData: () => empty,
  useAssistantTable: (table: keyof typeof empty) => empty[table],
  useCodex: () => empty,
  useSyncGate: () => ({ loading: false }),
  useAssistantStore: () => ({}),
}));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get) };
});

afterEach(() => setView({ list: 'today' }));

const overview = () => {
  const now = Date.now();
  const end = new Date(now).setHours(23, 59, 59, 999);
  const s = { ...sharedSplit([], 'all', now), next: undefined, endOfDay: end, meetingsToday: [], nextLater: undefined };
  return <Overview s={s as never} dueToday={[]} onPrep={() => {}} />;
};

const tasks = () => {
  setView({ list: 'tasks' });
  return <Assistant />;
};

const empties = (html: string) => html.match(/class="ui-empty /g)?.length ?? 0;

describe('page smoke', () => {
  it.each<[string, () => ReactElement, (html: string) => void]>([
    ['Overview', overview, (html) => {
      expect(empties(html)).toBe(1);
      for (const label of ['Needs you', 'Reply queue', 'Reports']) expect(html).not.toContain(label);
    }],
    ['Overview header', () => <Assistant />, (html) => {
      const head = html.match(/<div class="tasks-head">(.*?)<div class="as-ptr"/s)?.[1] ?? '';
      expect(head).toContain('role="heading"');
      expect(head).toContain('<span class="ui-section-actions"></span>');
      expect(head).not.toMatch(/as-focus-chip|muted|ui-section-count/);
      expect(head.match(/<button/g)).toHaveLength(1);
    }],
    ['Tasks', tasks, (html) => expect(empties(html)).toBe(1)],
    ['Meetings', () => <Meetings onMenu={() => {}} />, (html) => expect(empties(html)).toBe(2)],
    ['Design', () => <DesignPage />, () => {}],
    ['Settings', () => <Settings dev={false} debug={async () => false} />, (html) => expect(html).toContain('App version')],
  ])('%s renders on an empty store', (_name, page, check) => {
    const html = renderToStaticMarkup(page());
    expect(html.length).toBeGreaterThan(0);
    check(html);
  });
});
