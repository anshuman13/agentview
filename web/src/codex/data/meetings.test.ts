import { expect, it } from 'vitest';
import { cadenceOf, countdown, isSolo, meetingState, nextInSeries, seriesPeople } from './meetings';
import type { Meeting } from './wiki';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 29, 12);
const meeting = (id: string, at: number, extra: Partial<Meeting> = {}) =>
  ({ id, profile: 'work', deleted: 0, title: 'Sync', starts_at: at, people: 'Ann, Bo', ...extra }) as Meeting;
const every = (gap: number, n = 4) => Array.from({ length: n }, (_, i) => meeting(`m${i}`, now - i * gap * DAY));

it('names the median gap between occurrences', () => {
  expect([1, 7, 14, 30].map((g) => cadenceOf(every(g)))).toEqual(['Daily', 'Weekly', 'Every 2 weeks', 'Monthly']);
  expect([3, 4, 10, 11, 17, 25, 40].map((g) => cadenceOf(every(g)))).toEqual(Array(7).fill(null));
  expect(cadenceOf([meeting('a', now)])).toBeNull();
});

it('uses the median so one odd gap does not decide', () => {
  const days = [0, 7, 14, 21, 60];
  expect(cadenceOf(days.map((d, i) => meeting(`m${i}`, now - d * DAY)))).toBe('Weekly');
});

it('picks the earliest upcoming meeting of the series', () => {
  const meetings = [
    meeting('past', now - DAY),
    meeting('late', now + 7 * DAY),
    meeting('soon', now + DAY),
    meeting('gone', now + 0.5 * DAY, { deleted: 1 }),
    meeting('other-profile', now + 0.4 * DAY, { profile: 'personal' }),
    meeting('other-title', now + 0.3 * DAY, { title: 'Planning' }),
    meeting('single', now + 0.2 * DAY, { title: 'Offsite' }),
    meeting('no-guests-shared', now + 0.1 * DAY, { people: 'Cy, Di' }),
  ];
  expect(nextInSeries(meetings, 'work', 'sync', now)?.id).toBe('soon');
  expect(nextInSeries(meetings.slice(0, 1), 'work', 'sync', now)).toBeUndefined();
});

it('counts a person once across occurrences', () => {
  const members = [meeting('a', now, { people: 'Ann, Bo' }), meeting('b', now - DAY, { people: 'ann, Cy' }), meeting('c', now - 2 * DAY, { people: 'Bo' })];
  expect(seriesPeople(members)).toHaveLength(3);
  expect(seriesPeople([])).toEqual([]);
});

it('counts down to the start, then to the end while it runs', () => {
  const MIN = 60000;
  const m = meeting('c', now + 30 * MIN, { ends_at: now + 90 * MIN });
  expect(countdown(m, now)).toBe('Starts in 30 min');
  expect(countdown(m, now + 40 * MIN)).toBe('Ends in 50 min');
  expect(countdown(m, now - 95 * MIN)).toBe('Starts in 2h 5m');
  expect(countdown(m, now - 30 * MIN + 1)).toBe('Starts in 1h');
  expect(countdown(m, now + 30 * MIN - 30000)).toBe('Starts now');
  expect(countdown(m, now + 90 * MIN - 30000)).toBe('Ends in 1 min');
  expect(countdown(m, now + 90 * MIN)).toBeNull();
  expect(countdown(meeting('d', now), now + MIN)).toBeNull();
});

it('treats an attendee-less calendar meeting as solo and past ones as manual', () => {
  const solo = meeting('cal:a', now, { people: '[]', ends_at: now + DAY / 24 });
  expect(isSolo(solo)).toBe(true);
  expect(isSolo(meeting('cal:b', now))).toBe(false);
  expect(isSolo(meeting('local', now, { people: '[]' }))).toBe(false);
  expect(isSolo(meeting('cal:c', now, { people: null }))).toBe(false);
  expect(meetingState(solo, now - DAY)).toBe('upcoming');
  expect(meetingState(solo, now + 60000)).toBe('live');
  expect(meetingState(solo, now + DAY)).toBe('manual');
  expect(meetingState(meeting('cal:b', now, { ends_at: now + 1 }), now + DAY)).toBe('waiting');
});
