import { describe, expect, it } from 'vitest';
import { edited, hasDay, isQuestion, latestDigest, moved, newCapture, nextNine, parseWhen, split, splitTitle, stripWhen } from './engine';
import { rowToChange, type ItemRow } from './sync';

const now = new Date(2026, 9, 26, 17, 3, 20);
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const read = (s: string, at = now) => {
  const w = parseWhen(s, at);
  return { at: w?.at, title: stripWhen(s, w) };
};

describe('splitTitle', () => {
  it('keeps every word of a long first line', () => {
    const line = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const { title, text } = splitTitle(line);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(`${title} ${text}`).toBe(line);
  });
});

describe('parseWhen', () => {
  it('reads relative times', () => {
    expect(read('add a task to get burger buns set a reminder 1 hour from now')).toEqual({ at: local(26, 18, 4), title: 'get burger buns' });
    expect(read('call mum in an hour').at).toBe(local(26, 18, 4));
    expect(read('tea in 30 min').at).toBe(local(26, 17, 34));
    expect(read('tea in 15m')).toEqual({ at: local(26, 17, 19), title: 'tea' });
    expect(read('in half an hour stretch').at).toBe(local(26, 17, 34));
    expect(read('pay rent in 2 days').at).toBe(local(28, 17, 4));
    expect(read('water plants in half a day').at).toBe(local(27, 5, 4));
  });

  it('reads dates and times', () => {
    expect(read('call the bank tomorrow 9')).toEqual({ at: local(27, 9), title: 'call the bank' });
    expect(read('demo fri at 14:30').at).toBe(local(30, 14, 30));
    expect(read('call at 10pm').at).toBe(local(26, 22));
    expect(read('standup 9').at).toBeUndefined();
    expect(read('call at 9').at).toBe(local(27, 9));
  });

  it('reads next weekday', () => {
    expect(read('call bank next tue')).toEqual({ at: local(34, 9), title: 'call bank' });
    expect(read('tue').at).toBe(local(27, 9));
    expect(read('next tue', new Date(2026, 9, 31, 12)).at).toBe(local(34, 9));
    expect(read('next tue', new Date(2026, 10, 1, 12)).at).toBe(local(34, 9));
    expect(read('next mon', new Date(2026, 10, 1, 12)).at).toBe(local(33, 9));
    expect(read('next mon', new Date(2026, 9, 30, 12)).at).toBe(local(33, 9));
    expect(read('next monday').at).toBe(local(33, 9));
    expect(read('next sun').at).toBe(local(39, 9));
    expect(read('next tue', new Date(2026, 9, 27, 10)).at).toBe(local(34, 9));
    expect(read('call on next tue')).toEqual({ at: local(34, 9), title: 'call' });
    expect(read('finish by next tue')).toEqual({ at: local(34, 9), title: 'finish by' });
    expect(read('prep slides next tue 3pm')).toEqual({ at: local(34, 15), title: 'prep slides' });
    expect(read('next tue at 15:30').at).toBe(local(34, 15, 30));
    expect(read('next tue morning').at).toBe(local(34, 9));
    expect(read('next tue 25:00').at).toBeUndefined();
    expect(hasDay('prep next tue')).toBe(true);
    expect(hasDay('report end of week')).toBe(true);
  });

  it('reads end of week', () => {
    expect(read('end of week').at).toBe(local(30, 17));
    expect(read('report eow')).toEqual({ at: local(30, 17), title: 'report' });
    expect(read('end of the week').at).toBe(local(30, 17));
    expect(read('end of week 3pm').at).toBe(local(30, 15));
    expect(read('end of week morning').at).toBe(local(30, 9));
    for (const d of [new Date(2026, 9, 30, 18), new Date(2026, 9, 31, 12), new Date(2026, 10, 1, 12)]) expect(read('end of week', d).at).toBe(local(37, 17));
    const fri16 = new Date(2026, 9, 30, 16);
    expect(read('end of week', fri16).at).toBe(local(30, 17));
    expect(read('end of week 3pm', fri16).at).toBe(local(37, 15));
    expect(read('end of week morning', new Date(2026, 9, 30, 10)).at).toBe(local(37, 9));
    expect(read('end of week 3pm', new Date(2026, 9, 30, 10)).at).toBe(local(30, 15));
  });

  it('reads a time after a day span', () => {
    expect(read('report in 3 days 3pm')).toEqual({ at: local(29, 15), title: 'report' });
    expect(read('pay rent in 2 days').at).toBe(local(28, 17, 4));
    expect(read('in a week 3pm').at).toBe(local(33, 15));
    expect(read('x in 3 days morning')).toEqual({ at: local(29, 17, 4), title: 'x morning' });
    expect(read('x in 3 days 5 items')).toEqual({ at: local(29, 17, 4), title: 'x 5 items' });
    expect(read('call in 2 hours 3pm')).toEqual({ at: local(26, 19, 4), title: 'call 3pm' });
    expect(read('water plants in half a day 3pm')).toEqual({ at: local(27, 5, 4), title: 'water plants 3pm' });
    expect(read('x in 3 days 15:30')).toEqual({ at: local(29, 15, 30), title: 'x' });
    expect(read('x in 3 days at 25:00').at).toBeUndefined();
    expect(read('x in 3 days 25:00').at).toBeUndefined();
    expect(read('next tue in 3 days')).toEqual({ at: local(29, 17, 4), title: 'next tue' });
    expect(read('next week').at).toBe(local(33, 9));
  });

  it('leaves other text alone', () => {
    for (const s of ['next', 'end of the month', 'eowyn', 'buy 3 days of food']) expect(read(s)).toEqual({ at: undefined, title: s });
  });

  it('reads parts of the day', () => {
    expect(read('cook this evening')).toEqual({ at: local(26, 19), title: 'cook' });
    expect(read('run tomorrow morning')).toEqual({ at: local(27, 9), title: 'run' });
    expect(read('movie tonight at 8').at).toBe(local(26, 20));
    expect(read('gym this morning').at).toBe(local(27, 9));
    expect(read('dinner tomorrow evening 8')).toEqual({ at: local(27, 20), title: 'dinner' });
  });

  it('keeps today without a time in Today', () => {
    expect(read('buy milk today')).toEqual({ at: null, title: 'buy milk' });
  });

  it('leaves amounts that are not times alone', () => {
    expect(read('buy 2 days of food').at).toBeUndefined();
    expect(read('buy 12 eggs').at).toBeUndefined();
  });
});

describe('isQuestion', () => {
  it('keeps imperative tasks as tasks', () => {
    expect(isQuestion('Do laundry tomorrow')).toBe(false);
    expect(isQuestion('Prep slides fri 10')).toBe(false);
    expect(isQuestion('What is on today')).toBe(true);
    expect(isQuestion('laundry?')).toBe(true);
  });
});

describe('split', () => {
  const row = (id: string, status: string, at: number | null, extra: Partial<ItemRow> = {}): ItemRow => ({
    id, profile: 'work', version: 1, updated_at: local(20, 9), deleted: 0, field_times: '{}', dirty: 0,
    title: id, text: null, source: 'capture', source_url: null, people: null, at, status, meeting_id: null, rolls: null, rolled_from: null, rank: null, ...extra,
  });
  it('sorts tasks into overdue, today, later, review and done today', () => {
    const s = split([
      row('late', 'open', local(24, 9)), row('due', 'open', local(26, 9)), row('undated', 'open', null), row('soon', 'open', local(27, 9)),
      row('old meeting task', 'open', null, { source: 'meeting' }), row('calendar', 'open', local(26, 18), { source: 'calendar' }),
      row('yours?', 'suggested', null), row('nobody', 'unassigned', null), row('not mine', 'dismissed', null),
      row('done now', 'done', null, { field_times: JSON.stringify({ status: local(26, 10) }) }), row('done before', 'done', null, { field_times: JSON.stringify({ status: local(25, 10) }) }),
    ], 'all', now.getTime());
    const ids = (rs: ItemRow[]) => rs.map((r) => r.id);
    expect(ids(s.overdue)).toEqual(['late']);
    expect(ids(s.today)).toEqual(['undated', 'old meeting task', 'due']);
    expect(ids(s.later)).toEqual(['soon']);
    expect(ids(s.review)).toEqual(['yours?']);
    expect(ids(s.doneToday)).toEqual(['done now']);
  });
});

describe('moved', () => {
  const row = { ...newCapture('Call the bank\nAbout the loan', 'task', 'work', 1000, 5000), people: 'Ola', rank: 2, version: 7 };

  it('keeps every field under the other profile and sends them all', () => {
    const m = moved(row, undefined, 'personal', 2000);
    expect(m).toMatchObject({ id: row.id, profile: 'personal', version: 0, deleted: 0, dirty: 1, title: 'Call the bank', text: 'About the loan', at: 5000, people: 'Ola', rank: 2, status: 'open' });
    const change = rowToChange(m);
    expect(change).toMatchObject({ profile: 'personal', deleted: false, updated_at: 2000 });
    expect(change.fields).toMatchObject({ title: 'Call the bank', at: 5000, people: 'Ola', rank: 2, source_url: null });
  });

  it('restores the weekly goal when given', () => {
    expect(moved({ ...row, goal: 'g1' }, undefined, 'personal', 2000).goal).toBeNull();
    expect(moved(row, undefined, 'work', 2000, 'g1').goal).toBe('g1');
  });

  it('brings back a row moved away before', () => {
    const gone = edited({ ...row, profile: 'personal' as const, title: 'Old' }, { deleted: 1 }, 1500);
    const m = moved(row, gone, 'personal', 2000);
    expect(m).toMatchObject({ profile: 'personal', version: 7, deleted: 0, title: 'Call the bank' });
    expect(JSON.parse(m.field_times).deleted).toBe(2000);
  });
});

describe('latestDigest', () => {
  const note = (id: string, title: string, updated_at: number, extra: Partial<ItemRow> = {}): ItemRow => ({ ...newCapture(title, 'note', 'work', updated_at), id, title, updated_at, ...extra });
  const items = [note('a', 'Weekly digest', 100), note('b', 'Weekly digest, week 43', 300), note('c', 'Shopping', 400), note('d', 'Weekly digest', 500, { deleted: 1 }), note('e', 'Weekly digest', 200, { profile: 'personal' })];

  it('picks the newest live digest note', () => {
    expect(latestDigest(items, 'all')?.id).toBe('b');
    expect(latestDigest(items, 'personal')?.id).toBe('e');
    expect(latestDigest([items[2]], 'all')).toBeUndefined();
  });
});

describe('nextNine', () => {
  it('skips the weekend for work only', () => {
    const day = (t: number) => new Date(t).toDateString() + ' ' + new Date(t).getHours();
    const fri = new Date(2026, 9, 30, 15);
    expect(day(nextNine(fri, 'work'))).toBe('Mon Nov 02 2026 9');
    expect(day(nextNine(fri, 'personal'))).toBe('Sat Oct 31 2026 9');
    expect(day(nextNine(new Date(2026, 10, 2, 15), 'work'))).toBe('Tue Nov 03 2026 9');
  });
});

describe('runSync health fields', () => {
  it('asks for a full reply on the first run only and leaves state alone when the reply has no health', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const { runSync } = await import('./engine');
    const fulls: unknown[] = [];
    const paused = vi.fn();
    const scans = vi.fn();
    const io = {
      active: () => true,
      since: async () => 0,
      saveSince: async () => {},
      dirty: async () => [],
      post: async (_since: number, _changes: unknown[], full?: boolean) => (fulls.push(full), { version: 0, changes: [] }),
      clean: async () => {},
      apply: async () => {},
      paused,
      scans,
    };
    await runSync(io);
    await runSync(io);
    expect(fulls).toEqual([true, undefined]);
    expect(paused).not.toHaveBeenCalled();
    expect(scans).not.toHaveBeenCalled();
  });
});
