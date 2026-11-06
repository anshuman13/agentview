import { describe, expect, it } from 'vitest';
import { dayLabel, greeting, heavyDay, moveTo } from './days';

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

  it('marks a day with 3 meetings or 4 hours of them', () => {
    const m = (day: number, h: number, mins: number) => ({ starts_at: d(day, h), ends_at: d(day, h) + mins * 60000 });
    expect(heavyDay([m(4, 9, 30), m(4, 11, 30)], d(4))).toBe(false);
    expect(heavyDay([m(4, 9, 30), m(4, 11, 30), m(4, 14, 30)], d(4))).toBe(true);
    expect(heavyDay([m(4, 9, 120), m(4, 13, 120)], d(4))).toBe(true);
    expect(heavyDay([m(5, 9, 30), m(5, 10, 30), m(5, 11, 30), m(5, 9, 300)], d(4))).toBe(false);
  });
});
