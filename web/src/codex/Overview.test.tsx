import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Overview } from './Overview';
import type { ItemRow } from './data/sync';
import type { Meeting } from './data/wiki';

const mocks = vi.hoisted(() => ({ needs: [] as unknown[], queue: [] as unknown[] }));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get) };
});
vi.mock('./data', () => ({ useAssistantData: () => ({ items: [] }), useSyncGate: () => ({ loading: false }) }));
vi.mock('./useActions', () => ({ useActions: () => ({}) }));
vi.mock('./AddSheet', () => ({ AddSheet: () => null }));
vi.mock('./NeedsYou', () => ({ useNeedsYou: () => ({ rows: mocks.needs }) }));
vi.mock('./overview/ReplyQueue', () => ({ replyQueue: () => mocks.queue }));
vi.mock('./overview/Review', () => ({ Review: () => null }));
vi.mock('./overview/NeedsYouSheet', () => ({ NeedsYouSheet: () => null }));

const now = Date.now();
const at = (min: number) => now + min * 60000;
const task = (id: string, title: string, due: number | null) => ({ id, profile: 'work', title, at: due, status: 'open' }) as unknown as ItemRow;
const meeting = (id: string, title: string, start: number) => ({ id: `cal:${id}`, profile: 'work', title, starts_at: start, ends_at: start + 1800000, room: 'Room 4', people: 'Ada, Bo' }) as unknown as Meeting;

const render = (over: { next?: Meeting; meetingsToday?: Meeting[]; overdue?: ItemRow[]; later?: ItemRow[]; nextLater?: Meeting }, dueToday: ItemRow[] = []) => {
  const s = { next: undefined, meetingsToday: [], overdue: [], later: [], nextLater: undefined, ...over };
  return renderToStaticMarkup(<Overview s={s as never} dueToday={dueToday} onPrep={() => {}} />);
};

describe('Overview', () => {
  it('shows one empty state with the next dated task as the hint on an empty day', () => {
    mocks.needs = []; mocks.queue = [];
    const html = render({ later: [task('t', 'Plan trip', now + 3 * 86400000)] });
    expect(html).toContain('Nothing today');
    expect(html).toContain('Next: ');
    expect(html).toContain('Plan trip');
    expect(html).not.toContain('Up next');
    expect(html).not.toContain('Needs you');
  });

  it('puts the next meeting in Up next and the later ones in Today', () => {
    const a = meeting('a', 'Standup', at(30)), b = meeting('b', 'Review', at(120));
    const html = render({ next: a, meetingsToday: [a, b] });
    expect(html).toContain('Up next');
    expect(html).toContain('Standup');
    expect(html).toContain('2 people');
    expect(html).toContain('>Prep<');
    expect(html).toContain('>Today<');
    expect(html.match(/Review/g)).toHaveLength(1);
    expect(html.match(/Standup/g)).toHaveLength(1);
  });

  it('puts the first task due today in Up next with Done when no meeting is left, and overdue tasks only in Today', () => {
    const first = task('1', 'Send invoice', at(10)), second = task('2', 'Call back', at(60)), old = task('3', 'Renew pass', at(-3000));
    const html = render({ overdue: [old] }, [second, first]);
    expect(html).toContain('Up next');
    expect(html).toContain('>Done<');
    expect(html.indexOf('Send invoice')).toBeLessThan(html.indexOf('Call back'));
    expect(html).toContain('badge late');
    expect(html).not.toContain('Nothing today');
  });

  it('counts Needs you rows and queued asks, and hides the row at zero', () => {
    mocks.needs = [{ kind: 'wiki' }, { kind: 'dm' }]; mocks.queue = [{}];
    const html = render({ later: [] });
    expect(html).toContain('Needs you');
    expect(html).toContain('<span class="badge quiet">3</span>');
    mocks.needs = []; mocks.queue = [];
    expect(render({ later: [] })).not.toContain('Needs you');
  });

  it('shows 7 rows then Show all N', () => {
    mocks.needs = []; mocks.queue = [];
    const rows = Array.from({ length: 9 }, (_, i) => task(`r${i}`, `Chore ${i}`, at(10 + i)));
    const a = meeting('a', 'Standup', at(5));
    const html = render({ next: a, meetingsToday: [a] }, rows);
    expect(html).toContain('Show all 9');
    expect(html).toContain('Chore 6');
    expect(html).not.toContain('Chore 7');
  });
});
