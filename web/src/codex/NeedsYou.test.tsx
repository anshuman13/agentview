import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import type { ItemRow } from './data/sync';
import * as data from './data';
import * as view from './view';

const mocks = { store: {} as Record<string, ReturnType<typeof vi.fn>>, snack: vi.fn() };

const react = createRequire(import.meta.url)('react') as typeof import('react');
vi.mock('react', () => {
  const real = react;
  const { useSyncExternalStore } = real;
  return { ...real, useSyncExternalStore: (subscribe: never, get: () => unknown) => useSyncExternalStore(subscribe, get, get) };
});
vi.mock('./data', () => ({
  ...data,
  useAssistantStore: () => mocks.store,
  useAssistantData: () => ({ meetings: [], chats: [], briefs: [], items: [] }),
  useCodex: () => ({ facts: [] }),
}));
vi.mock('./useActions', () => ({ useActions: () => ({}) }));
vi.mock('../ui/haptic', () => ({ haptic: () => {} }));
vi.mock('./view', () => ({ ...view, showSnack: (...args: unknown[]) => mocks.snack(...args) }));
vi.mock('../ui/Row', () => ({ Row: ({ title, menu }: { title: string; menu?: React.ReactNode }) => <div>{title}{menu}</div> }));
vi.mock('./meetings/ActionRow', () => ({ ActionRow: ({ row, extraItems }: { row: ItemRow; extraItems?: (c: (f: () => void) => () => void) => React.ReactNode }) => <div>{row.title}{extraItems?.((f) => f)}</div> }));

const { NeedsYou, useNeedsYou } = await import('./NeedsYou');

const ask = { id: 'a', profile: 'work', title: 'Confirm the venue', status: 'suggested' } as unknown as ItemRow;
const dm = { profile: 'work', id: 'c', name: 'Ada', last_at: 1, summary: 'FYI', url: null };
const split = { overdue: [], today: [], later: [], review: [], meetingsToday: [] };

const rendered = () => {
  let n!: ReturnType<typeof useNeedsYou>;
  const Probe = () => { n = useNeedsYou(split as never, 0); return null; };
  renderToStaticMarkup(<Probe />);
  return n;
};
const show = (rows: unknown[]) => renderToStaticMarkup(<NeedsYou n={{ rows } as never} now={0} onShowOld={() => {}} />);

beforeEach(() => {
  mocks.snack.mockClear();
  mocks.store.capture = vi.fn();
  mocks.store.update = vi.fn(() => Promise.resolve());
});

describe('NeedsYou triage', () => {
  it('puts Nothing asked before Dismiss in the DM, Slack and ask menus, not on task rows', () => {
    const rows = [
      { kind: 'ask', row: ask, keys: [], marks: [] },
      { kind: 'dm', chat: dm, keys: [] },
      { kind: 'slack', x: { title: 'Reply to Bo', why: '', url: null }, profile: 'work', keys: ['s'] },
    ];
    const html = show(rows);
    expect(html.match(/Nothing asked/g)).toHaveLength(3);
    for (const part of html.split('Nothing asked').slice(1)) expect(part).toContain('Dismiss');
    expect(html.slice(html.indexOf('Ada'))).toMatch(/Nothing asked.*Dismiss.*Nothing asked.*Dismiss/s);
    expect(show([{ kind: 'overdue', row: { id: 'o', profile: 'work', title: 'Renew pass', at: 1 }, keys: [] }])).not.toContain('Nothing asked');
  });

  it('keeps the row and shows the error when the note write fails', async () => {
    mocks.store.capture = vi.fn(() => Promise.reject(new Error('offline')));
    rendered().chatNote(dm as never);
    await new Promise((r) => setTimeout(r));
    expect(mocks.snack).toHaveBeenCalledTimes(1);
    expect(mocks.snack).toHaveBeenCalledWith('Could not save the note. The item is still here.');
  });

  it('saves an ask as a note once and Undo puts it back to suggested', async () => {
    const n = rendered();
    n.askNote(ask);
    n.askNote(ask);
    await new Promise((r) => setTimeout(r));
    expect(mocks.store.update).toHaveBeenCalledTimes(1);
    expect(mocks.store.update).toHaveBeenCalledWith(ask, { status: 'note' });
    mocks.snack.mock.calls[0][1]();
    expect(mocks.store.update).toHaveBeenLastCalledWith(ask, { status: 'suggested' });
  });
});
