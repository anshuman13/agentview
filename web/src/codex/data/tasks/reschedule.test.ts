import { describe, expect, it } from 'bun:test';
import { snoozeLaterAt, todayAt } from './reschedule';

const d = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();

describe('reschedule', () => {
  it('snoozes to the next 09:00 after the later of due and now', () => {
    const now = d(4, 14);
    expect(snoozeLaterAt(null, now)).toBe(d(5, 9));
    expect(snoozeLaterAt(d(2, 10), now)).toBe(d(5, 9));
    expect(snoozeLaterAt(d(9, 10), now)).toBe(d(10, 9));
    expect(snoozeLaterAt(String(d(9, 10)), now)).toBe(d(10, 9));
  });

  it('skips the weekend for work tasks', () => {
    expect(snoozeLaterAt(null, d(6, 14), 'work')).toBe(d(9, 9));
    expect(snoozeLaterAt(null, d(6, 14), 'personal')).toBe(d(7, 9));
  });

  it('moves to today at the same time of day, or now once it has passed', () => {
    const now = d(4, 10, 30);
    expect(todayAt(d(1, 15, 45), now)).toBe(d(4, 15, 45));
    expect(todayAt(d(1, 8, 0), now)).toBe(now);
    expect(todayAt(null, now)).toBe(now);
  });
});
