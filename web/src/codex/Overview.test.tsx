import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Overview } from './Overview';
import { doneCount } from './overview/TodayList';
import { rowCounts } from '../app/store/counts';
import type { ItemRow } from './data/sync';
import type { Meeting } from './data/wiki/wiki';

const mocks = vi.hoisted(() => ({ needs: [] as unknown[], queue: [] as unknown[] }));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get) };
});
vi.mock('./data', () => ({ useAssistantData: () => ({ items: [] }), useAssistantStore: () => ({}), useSyncGate: () => ({ loading: false }) }));
vi.mock('./useActions', () => ({ useActions: () => ({}) }));
vi.mock('./tasks/AddSheet', () => ({ AddSheet: () => null }));
vi.mock('./NeedsYou', () => ({ useNeedsYou: () => ({ rows: mocks.needs }) }));
vi.mock('./overview/ReplyQueue', () => ({ replyQueue: () => mocks.queue }));
vi.mock('./overview/Review', () => ({ Review: () => null }));
vi.mock('./overview/NeedsYouSheet', () => ({ NeedsYouSheet: () => null }));

const now = Date.now();
const at = (min: number) => now + min * 60000;
const task = (id: string, title: string, due: number | null) => ({ id, profile: 'work', title, at: due, status: 'open' }) as unknown as ItemRow;
const meeting = (id: string, title: string, start: number) => ({ id: `cal:${id}`, profile: 'work', title, starts_at: start, ends_at: start + 1800000, room: 'Room 4', people: 'Ada, Bo' }) as unknown as Meeting;

const render = (over: { next?: Meeting; meetingsToday?: Meeting[]; overdue?: ItemRow[]; doneToday?: ItemRow[]; later?: ItemRow[]; nextLater?: Meeting }, dueToday: ItemRow[] = []) => {
  const s = { next: undefined, meetingsToday: [], overdue: [], doneToday: [], later: [], nextLater: undefined, ...over };
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
    expect(html).toContain('Starts in 30 min');
    expect(html).not.toContain('Live');
    expect(html).not.toContain('>Prep<');
    expect(html).toContain('aria-label="More"');
    expect(html).toContain('>Today<');
    expect(html.match(/Review/g)).toHaveLength(1);
    expect(html.match(/Standup/g)).toHaveLength(1);
  });

  it('shows Join and Starts in N min for a linked meeting in the 10 minute window only', () => {
    const linked = (url?: string, min = 5) => ({ ...meeting('a', 'Standup', at(min)), calendar_url: url }) as Meeting;
    const today = (m: Meeting) => render({ next: meeting('n', 'Early', at(-5)), meetingsToday: [m] });
    const html = today(linked('https://meet.example.com/x'));
    expect(html).toContain('Starts in 5 min');
    expect(html).toContain('>Join<');
    expect(html).toContain('href="https://meet.example.com/x"');
    for (const m of [linked(), linked('javascript:alert(1)'), linked('https://meet.example.com/x', 11)]) {
      const out = today(m);
      expect(out).not.toContain('Starts in');
      expect(out).not.toContain('>Join<');
    }
  });

  it('shows the Ends in countdown and Live badge on a running Up next meeting', () => {
    const html = render({ next: meeting('r', 'Standup', at(-10)), meetingsToday: [] });
    expect(html).toContain('Ends in 20 min');
    expect(html).toContain('Live');
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

  it('shows the Needs you count from the counts store, and hides the row at zero', () => {
    mocks.needs = [{ kind: 'wiki' }, { kind: 'dm' }]; mocks.queue = [{}];
    rowCounts.set({ needsYouRows: 2, replyRows: 1 });
    const html = render({ later: [] });
    expect(html).toContain('Needs you');
    expect(html).toContain('<span class="badge quiet">3</span>');
    mocks.needs = []; mocks.queue = [];
    rowCounts.set({ needsYouRows: 0, replyRows: 0 });
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

  it('shows N of M done in the Today header and only when something is done', () => {
    mocks.needs = []; mocks.queue = [];
    const done = ['a', 'b', 'c'].map((id) => ({ ...task(id, `Done ${id}`, at(-60)), status: 'done' }) as ItemRow);
    const open = Array.from({ length: 5 }, (_, i) => task(`o${i}`, `Chore ${i}`, at(10 + i)));
    expect(render({ doneToday: done }, open)).toContain('3 of 8 done');
    expect(render({}, open)).not.toContain(' done<');
    expect(doneCount(3, 5)).toBe('3 of 8 done');
    expect(doneCount(0, 5)).toBeUndefined();
  });

  it('never makes a done task the Up next card', () => {
    mocks.needs = []; mocks.queue = [];
    const finished = { ...task('d', 'Finished job', at(5)), status: 'done' } as ItemRow;
    const html = render({}, [finished]);
    expect(html).not.toContain('Finished job');
    expect(html).toContain('Nothing today');
  });

  it('renders no row badge in the Needs you sheet', async () => {
    const { NeedsYou } = await vi.importActual<typeof import('./NeedsYou')>('./NeedsYou');
    const ask = { ...task('a', 'Confirm the venue', at(-60)), status: 'suggested' } as ItemRow;
    const rows = [
      { kind: 'overdue', row: task('o', 'Renew pass', at(-3000)), keys: [] },
      { kind: 'risk', row: task('r', 'Send invoice', at(60)), due: at(60), short: 20, keys: [] },
      { kind: 'ask', row: ask, keys: [], marks: [] },
      { kind: 'dm', chat: { profile: 'work', id: 'c', name: 'Ada', last_at: now, summary: 'Ping', url: null }, keys: [] },
      { kind: 'slack', x: { title: 'Reply to Bo', why: 'asked twice', url: null }, profile: 'work', keys: ['s'] },
    ];
    const html = renderToStaticMarkup(<NeedsYou n={{ rows } as never} now={now} onShowOld={() => {}} />);
    expect(html).toContain('Overdue · due');
    expect(html).toContain('At risk · due');
    expect(html).not.toMatch(/class="badge (?!quiet)/);
  });
});
