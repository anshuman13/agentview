import { describe, expect, it } from 'vitest';
import { slots, when } from './time';

describe('time slots', () => {
  it('names morning and evening slots and offers only those still ahead today', () => {
    const now = new Date(2026, 9, 26, 12, 0);
    expect(slots(now).map((s) => s.label)).toEqual(['This evening', 'Tomorrow morning', 'Tomorrow evening', 'Next week']);
    expect(when(new Date(2026, 9, 26, 19).getTime(), now.getTime())).toBe('this evening');
    expect(when(new Date(2026, 9, 27, 9).getTime(), now.getTime())).toBe('tomorrow morning');
    expect(when(new Date(2026, 9, 27, 14, 30).getTime(), now.getTime())).toBe('tomorrow 14:30');
  });
});
