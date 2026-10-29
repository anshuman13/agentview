process.env.TZ = 'Europe/Oslo';

import { expect, it } from 'vitest';
import { meetingLoad } from './load';
import type { Meeting } from './wiki';

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
  ], now);
  expect(weeks.map((w) => new Date(w.start).getDate())).toEqual([5, 12, 19, 26]);
  expect(weeks.map((w) => w.hours)).toEqual([0, 0, 1, 10]);
  expect(weeks[2].recorded).toBe(1);
  expect(weeks[3].unrecorded).toBe(2);
  expect(people[0]).toEqual({ name: 'Ann', hours: 11 });
});
