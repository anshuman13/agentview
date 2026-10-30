import { describe, expect, it } from 'vitest';
import type { ItemRow } from './sync';
import { nextMonday, nudgeText, waitingByPerson, weeklyReview, weekStart } from './review';

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

  it('adds unanswered mail to the same person and nudges by subject', () => {
    const now = new Date(2026, 9, 30).getTime();
    const g = waitingByPerson([row({ id: '1', title: 'Waiting on Sara: contract', updated_at: now - 3 * 86400000 })], now, [{ thread: 't1', url: 'https://mail.example.test/t1', to: 'sara', subject: 'Budget', sent_at: now - 5 * 86400000 }]);
    expect(g.map((x) => [x.name, x.rows.map((y) => [y.title, y.days])])).toEqual([['Sara', [['Budget', 5], ['contract', 3]]]]);
    expect(nudgeText(g[0])).toBe('Hi Sara, a quick nudge on Budget; contract. Any update when you have a moment? Thanks!');
  });
});
