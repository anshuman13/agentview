process.env.TZ = 'Europe/Oslo';

import { describe, expect, it } from 'vitest';
import { meetingLoad, meetingTimeLeft, sinceLastVisit, weekReview } from './load';
import type { ItemRow } from './sync';
import type { Fact, Meeting } from './wiki';

const meeting = (id: string, start: Date, hours: number, extra: Partial<Meeting> = {}) =>
  ({ id, profile: 'work', deleted: 0, starts_at: start.getTime(), ends_at: start.getTime() + hours * 3600_000, people: 'Ann, Bo', recorded_ms: null, ...extra }) as Meeting;

it('sums hours per local week across the October clock change, caps one meeting and skips the future', () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  const { weeks, people } = meetingLoad([
    meeting('sun', new Date(2026, 9, 25, 10), 1, { recorded_ms: 60000 }),
    meeting('mon', new Date(2026, 9, 26, 0, 30), 2, { people: 'ann@example.com, Bo' }),
    meeting('long', new Date(2026, 9, 27, 9), 12),
    meeting('next', new Date(2026, 9, 30, 9), 1),
    meeting('gone', new Date(2026, 9, 28, 9), 1, { deleted: 1 }),
    meeting('open', new Date(2026, 9, 28, 9), 1, { ends_at: null }),
    meeting('old', new Date(2026, 8, 20, 9), 1),
    meeting('ooo', new Date(2026, 9, 27), 24),
  ], now);
  expect(weeks.map((w) => new Date(w.start).getDate())).toEqual([5, 12, 19, 26]);
  expect(weeks.map((w) => w.hours)).toEqual([0, 0, 1, 10]);
  expect(weeks[2].recorded).toBe(1);
  expect(weeks[3].unrecorded).toBe(2);
  expect(people[0]).toEqual({ name: 'Ann', hours: 11 });
});

it('totals minutes per series over four weeks against the four before, skipping all-day events', () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  const item = (id: string, extra: Partial<ItemRow>) => ({ id, profile: 'work', deleted: 0, meeting_id: 's1', status: 'open', updated_at: now, ...extra }) as ItemRow;
  const items = [
    item('a1', { status: 'done' }),
    item('a2', { updated_at: now - 3 * 86_400_000 }),
    item('a3', { updated_at: now - 9 * 86_400_000, deleted: 1 }),
    item('a4', { meeting_id: 's2', updated_at: now - 5 * 86_400_000 }),
  ];
  const { series } = meetingLoad([
    meeting('s1', new Date(2026, 9, 27, 9), 1, { title: 'Standup #12' }),
    meeting('s2', new Date(2026, 9, 20, 9), 1, { title: 'Standup #11' }),
    meeting('s3', new Date(2026, 8, 20, 9), 1, { title: 'Standup #7' }),
    meeting('p1', new Date(2026, 9, 22, 9), 2, { title: 'Planning' }),
    meeting('n1', new Date(2026, 9, 21, 9), 0.5, { title: 'Retro' }),
    meeting('r1', new Date(2026, 9, 15, 9), 0.5, { title: 'Retro' }),
    meeting('off', new Date(2026, 9, 26), 24, { title: 'Offsite' }),
    meeting('dst1', new Date(2026, 9, 24), 49, { title: 'Away' }),
    meeting('dst2', new Date(2026, 9, 17, 9), 1, { title: 'Away' }),
  ], now, 4, items);
  expect(series.map((s) => [s.title, s.minutes, s.change])).toEqual([['Standup #12', 120, 60], ['Retro', 60, null]]);
  expect(series.map((s) => [s.done, s.total, s.oldestOpen])).toEqual([[1, 3, now - 5 * 86_400_000], [0, 0, null]]);
});

it('reviews the local week with decisions, claims, finished tasks and open meeting actions', () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  const at = (d: number) => new Date(2026, 9, d, 9).getTime();
  const meetings = [
    meeting('a', new Date(2026, 9, 27, 9), 1, { decisions: '["Ship it","Cut scope"]' }),
    meeting('b', new Date(2026, 9, 25, 9), 1, { decisions: '["Last week"]' }),
  ];
  const fact = (id: string, time: number, extra: Partial<Fact> = {}) => ({ id, profile: 'work', deleted: 0, state: 'live', at: time, updated_at: time, superseded_by: null, ...extra }) as Fact;
  const facts = [fact('new', at(28)), fact('old', at(20)), fact('sup', at(28), { superseded_by: 'new' }), fact('gone', at(28), { deleted: 1 })];
  const item = (id: string, extra: Partial<ItemRow>) => ({ id, profile: 'work', deleted: 0, source: null, meeting_id: null, updated_at: at(28), field_times: '{}', ...extra }) as ItemRow;
  const items = [
    item('d1', { status: 'done' }),
    item('d2', { status: 'done', field_times: JSON.stringify({ status: at(20) }) }),
    item('o1', { status: 'open', meeting_id: 'a' }),
    item('o2', { status: 'open', meeting_id: 'b' }),
  ];
  const r = weekReview({ meetings, facts, items }, now);
  expect([r.meetings, r.hours, r.decisions.length, r.claims.length, r.done.length, r.open.map((i) => i.id)]).toEqual([1, 1, 2, 1, 1, ['o1']]);
});

it('counts meetings, decisions, claims and open questions after the last visit', () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  const since = new Date(2026, 9, 27, 12).getTime();
  const at = (d: number) => new Date(2026, 9, d, 9).getTime();
  const meetings = [
    meeting('a', new Date(2026, 9, 28, 9), 1, { decisions: '["Ship it","Cut scope"]', summary: 'Who owns launch?' }),
    meeting('before', new Date(2026, 9, 26, 9), 1, { decisions: '["Old"]', summary: 'Why now?' }),
    meeting('future', new Date(2026, 9, 30, 9), 1, { decisions: '["Later"]' }),
    meeting('ooo', new Date(2026, 9, 28), 24),
  ];
  const fact = (id: string, time: number, extra: Partial<Fact> = {}) => ({ id, profile: 'work', deleted: 0, state: 'live', at: time, updated_at: time, superseded_by: null, ...extra }) as Fact;
  const facts = [fact('new', at(28)), fact('old', at(26)), fact('sup', at(28), { superseded_by: 'new' }), fact('gone', at(28), { deleted: 1 })];
  expect(sinceLastVisit({ meetings, facts }, since, now)).toEqual({ meetings: 1, decisions: 2, claims: 1, questions: 1 });
  expect(sinceLastVisit({ meetings, facts }, since, now, ['work:who owns launch?']).questions).toBe(0);
});

describe('meetingTimeLeft', () => {
  it('counts overlaps once, clips to now and skips all-day events', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m).getTime();
    const mt = (id: string, a: number, b: number) => ({ id, starts_at: a, ends_at: b }) as Meeting;
    const day = [mt('a', at(9), at(10)), mt('b', at(9, 30), at(11)), mt('c', at(13), at(13, 30)), mt('all', at(0), at(24))];
    expect(meetingTimeLeft(day, at(9, 15), at(24))).toBe(135);
  });
});
