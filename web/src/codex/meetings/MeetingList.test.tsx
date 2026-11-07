import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeetingsList } from './MeetingList';

vi.hoisted(() => {
  const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('location', { search: '', hash: '' });
});

const empty = vi.hoisted(() => ({ items: [], meetings: [], jobs: [], runs: [], pages: [], facts: [], actions: [], chats: [], briefs: [], phase: 'ready', message: '' }));

vi.mock('../data', () => ({
  useAssistantData: () => empty,
  useCodex: () => empty,
  useAssistantStore: () => ({}),
}));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get) };
});

describe('MeetingsList', () => {
  it('shows no filter chips, topic bar or Upcoming and Earlier headers by default', () => {
    const html = renderToStaticMarkup(<MeetingsList onMenu={() => {}} />);
    expect(html).not.toContain('mt-chips');
    expect(html).not.toContain('mt-topics');
    expect(html).not.toContain('Upcoming');
    expect(html).not.toContain('Earlier');
    expect(html).toContain('No past meetings yet');
    expect(html).toContain('Coming meetings are listed by day');
  });
});
