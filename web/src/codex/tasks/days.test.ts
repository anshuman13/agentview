import { describe, expect, it } from 'vitest';
import { moveTo } from './days';

const d = (day: number, h = 0, m = 0) => new Date(2026, 10, day, h, m).getTime();

describe('days', () => {
  it('moves a task to a day keeping its time of day', () => {
    const today = d(4);
    expect(moveTo({ at: d(2, 15, 30) }, d(6), today)).toBe(d(6, 15, 30));
    expect(moveTo({ at: d(6, 15, 30) }, d(6), today)).toBeUndefined();
    expect(moveTo({ at: null }, today, today)).toBeUndefined();
    expect(moveTo({ at: null }, d(6), today)).toBe(d(6, 9));
    expect(moveTo({ at: String(d(2, 8)) }, d(6), today)).toBe(d(6, 8));
  });
});
