import { describe, expect, it } from 'vitest';
import { dayLabel, greeting, moveTo } from './days';

const d = (day: number, h = 0, m = 0) => new Date(2026, 10, day, h, m).getTime();

describe('days', () => {
  it('greets by the hour', () => {
    expect([3, 9, 14, 20].map((h) => greeting(h))).toEqual(['Good night', 'Good morning', 'Good afternoon', 'Good evening']);
  });

  it('labels tomorrow by name and other days by date', () => {
    expect(dayLabel(d(5, 9), d(4, 12))).toBe('Tomorrow');
    expect(dayLabel(d(6, 9), d(4, 12))).toMatch(/6/);
  });

  it('moves a task to a day keeping its time of day', () => {
    const today = d(4);
    expect(moveTo({ at: d(2, 15, 30) }, d(6), today)).toBe(d(6, 15, 30));
    expect(moveTo({ at: d(6, 15, 30) }, d(6), today)).toBeUndefined();
    expect(moveTo({ at: null }, today, today)).toBeUndefined();
    expect(moveTo({ at: null }, d(6), today)).toBe(d(6, 9));
    expect(moveTo({ at: String(d(2, 8)) }, d(6), today)).toBe(d(6, 8));
  });

});
