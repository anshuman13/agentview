import { describe, expect, it } from 'vitest';
import { edited, isQuestion, latestDigest, moved, newCapture, parseWhen, split, staleTasks, stripWhen } from './engine';
import { rowToChange, type ItemRow } from './sync';

const now = new Date(2026, 9, 26, 17, 3, 20);
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const read = (s: string) => {
  const w = parseWhen(s, now);
  return { at: w?.at, title: stripWhen(s, w) };
};

describe('parseWhen', () => {
  it('reads relative times', () => {
    expect(read('add a task to get burger buns set a reminder 1 hour from now')).toEqual({ at: local(26, 18, 4), title: 'get burger buns' });
    expect(read('call mum in an hour').at).toBe(local(26, 18, 4));
    expect(read('tea in 30 min').at).toBe(local(26, 17, 34));
    expect(read('tea in 15m')).toEqual({ at: local(26, 17, 19), title: 'tea' });
    expect(read('in half an hour stretch').at).toBe(local(26, 17, 34));
    expect(read('pay rent in 2 days').at).toBe(local(28, 17, 4));
  });

  it('reads dates and times', () => {
    expect(read('call the bank tomorrow 9')).toEqual({ at: local(27, 9), title: 'call the bank' });
    expect(read('demo fri at 14:30').at).toBe(local(30, 14, 30));
    expect(read('call at 10pm').at).toBe(local(26, 22));
    expect(read('standup 9').at).toBeUndefined();
    expect(read('call at 9').at).toBe(local(27, 9));
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

describe('staleTasks', () => {
  const day = 86400000;
  const t = now.getTime();
  const row = (id: string, extra: Partial<ItemRow> = {}): ItemRow => ({
    id, profile: 'work', version: 1, updated_at: t - 20 * day, deleted: 0, field_times: '{}', dirty: 0,
    title: id, text: null, source: 'capture', source_url: null, people: null, at: null, status: 'open', meeting_id: null, rolls: null, rolled_from: null, rank: null, ...extra,
  });
  it('lists open tasks untouched for more than 14 days, oldest first', () => {
    const rows = [
      row('b', { updated_at: t - 15 * day }), row('a', { updated_at: t - 30 * day }), row('edge', { updated_at: t - 14 * day }), row('fresh', { updated_at: t - 2 * day }),
    ];
    expect(staleTasks(rows, t).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('skips calendar rows, deleted rows and other statuses', () => {
    const rows = [row('cal', { source: 'calendar' }), row('gone', { deleted: 1 }), row('done', { status: 'done' }), row('note', { status: 'note' }), row('sug', { status: 'suggested' }), row('ok')];
    expect(staleTasks(rows, t).map((r) => r.id)).toEqual(['ok']);
  });
  it('counts a recent status change as activity', () => {
    const rows = [row('reopened', { field_times: JSON.stringify({ status: t - day }), updated_at: t - 20 * day })];
    expect(staleTasks(rows, t)).toEqual([]);
  });
});
