import { describe, expect, it } from 'bun:test';
import type { ItemRow } from '../sync';
import type { Meeting } from '../wiki/wiki';
import { betweenRows, openTasksOf, nextMonday, nudgeText, waitingByPerson, weeklyReview } from './review';
import { weekStart } from '../dates';

const row = (o: Partial<ItemRow>): ItemRow => ({ id: 'x', profile: 'work', version: 0, updated_at: 0, deleted: 0, field_times: '{}', dirty: 0, title: 't', text: null, source: null, source_url: null, people: null, at: null, status: 'open', meeting_id: null, rolls: null, rolled_from: null, rank: null, ...o });

const sun = new Date(2026, 9, 25, 23, 0).getTime();
const mon = new Date(2026, 9, 26, 0, 0).getTime();
const wed = new Date(2026, 9, 28, 12, 0).getTime();

describe('week bounds', () => {
  it('starts on Monday and treats Sunday night as the old week', () => {
    expect(weekStart(sun)).toBe(new Date(2026, 9, 19).getTime());
    expect(weekStart(mon)).toBe(mon);
    expect(nextMonday(wed)).toBe(new Date(2026, 10, 2, 9).getTime());
  });
});

describe('weeklyReview', () => {
  it('splits done, slipped and stuck without double counting', () => {
    const now = new Date(2026, 9, 30, 12).getTime();
    const done = row({ id: 'd', status: 'done', updated_at: wed });
    const late = row({ id: 'l', at: wed });
    const moved = row({ id: 'm', rolled_from: wed, at: now + 86400000, rolls: 4 });
    const old = row({ id: 'o', updated_at: now - 40 * 86400000 });
    const r = weeklyReview([done, late, moved, old], now);
    expect(r.done.map((x) => x.id)).toEqual(['d']);
    expect(r.slipped.map((x) => x.id)).toEqual(['l', 'm']);
    expect(r.stuck.map((x) => x.id)).toEqual(['o']);
  });
});

describe('waitingByPerson', () => {
  it('groups by person from title forms and people plus the word waiting', () => {
    const now = new Date(2026, 9, 30).getTime();
    const g = waitingByPerson([
      row({ id: '1', title: 'Waiting on Sara: contract', updated_at: now - 3 * 86400000 }),
      row({ id: '2', title: '@sara pricing', updated_at: now - 9 * 86400000 }),
      row({ id: '3', title: 'Reply', people: 'Jon', text: 'still waiting', updated_at: now - 86400000 }),
      row({ id: '4', title: 'Reply', people: 'Jon' }),
      row({ id: '5', title: 'Waiting on Sara', status: 'done' }),
    ], now);
    expect(g.map((x) => [x.name, x.rows.map((y) => y.row?.id)])).toEqual([['Sara', ['2', '1']], ['Jon', ['3']]]);
    expect(g[0].rows[0].days).toBe(9);
  });

  it('puts late rows and groups first', () => {
    const now = new Date(2026, 10, 18, 12).getTime();
    const g = waitingByPerson([
      row({ id: '1', title: 'Waiting on Ann: a', updated_at: now - 86400000 }),
      row({ id: '2', title: 'Waiting on Bo: b', updated_at: now - 8 * 86400000 }),
    ], now, [{ thread: 't', url: 'u', to: 'Ann', subject: 'old mail', sent_at: now - 9 * 86400000 }]);
    expect(g.map((x) => [x.name, x.rows.map((y) => [y.title, y.late])])).toEqual([['Ann', [['old mail', true], ['a', false]]], ['Bo', [['b', true]]]]);
  });

  it('adds unanswered mail to the same person and nudges by subject', () => {
    const now = new Date(2026, 9, 30).getTime();
    const g = waitingByPerson([row({ id: '1', title: 'Waiting on Sara: contract', updated_at: now - 3 * 86400000 })], now, [{ thread: 't1', url: 'https://mail.example.test/t1', to: 'sara', subject: 'Budget', sent_at: now - 5 * 86400000 }]);
    expect(g.map((x) => [x.name, x.rows.map((y) => [y.title, y.days])])).toEqual([['Sara', [['Budget', 5], ['contract', 3]]]]);
    expect(nudgeText(g[0])).toBe('Hi Sara, a quick nudge on Budget; contract. Any update when you have a moment? Thanks!');
  });
});

describe('openTasksOf', () => {
  it('keeps open tasks naming the person and drops asks, done and other people', () => {
    const mine = row({ id: 'a', people: 'Ada Lovelace' });
    const ask = row({ id: 'b', people: 'Ada Lovelace · DM', source: 'slack' });
    const done = row({ id: 'c', people: 'Ada Lovelace', status: 'done' });
    const other = row({ id: 'd', people: 'Grace Hopper' });
    expect(openTasksOf('Ada Lovelace', [mine, ask, done, other]).map((x) => x.id)).toEqual(['a']);
  });
});

describe('betweenRows', () => {
  const mail = (n: number) => Array.from({ length: n }, (_, i) => ({ thread: `t${i}`, url: `u${i}`, to: 'Ada', subject: `m${i}`, sent_at: 0 }));
  const inbox = (o: Partial<Parameters<typeof betweenRows>[0]>) => ({ dm: null, asks: [], promises: [], mail: [], ...o });
  it('orders promises, asks and mail, capped at 5', () => {
    const rows = betweenRows(inbox({ promises: [row({ id: 'said:1', title: 'p' })], asks: [row({ id: 'a', title: 'a' })], mail: mail(5) }), 'Ada');
    expect(rows.map((r) => r.title)).toEqual(['p', 'a', 'm0', 'm1', 'm2']);
  });
  it('keeps the DM thread as the fifth row', () => {
    const dm = { summary: 'line one\nline two', url: 'https://slack/x' } as never;
    const rows = betweenRows(inbox({ dm, mail: mail(6) }), 'Ada');
    expect(rows.map((r) => r.title)).toEqual(['m0', 'm1', 'm2', 'm3', 'Slack DM']);
    expect(rows[4]).toMatchObject({ meta: 'line one', url: 'https://slack/x' });
  });
  it('is empty with nothing open', () => {
    expect(betweenRows(inbox({}), 'Ada')).toEqual([]);
  });
});
