import { describe, expect, it } from 'vitest';
import { slots, when } from './time';

describe('snooze text', () => {
  it('shows the clock time and flags quiet hours on relative options', async () => {
    const { snoozeText, snoozes } = await import('./AskBar');
    const now = new Date(2026, 9, 26, 16, 30);
    const [hour, three] = snoozes(now);
    expect(snoozeText(hour, now)).toBe('In 1 hour · 17:30 · reminder 08:00');
    expect(snoozeText(three, new Date(2026, 9, 26, 10, 0))).toBe('In 3 hours · 13:00');
    expect(snoozeText({ label: 'Tomorrow', at: () => 0 }, now)).toBe('Tomorrow');
  });
});

describe('time slots', () => {
  it('names morning and evening slots and offers only those still ahead today', () => {
    const now = new Date(2026, 9, 26, 12, 0);
    expect(slots(now).map((s) => s.label)).toEqual(['This evening', 'Tomorrow morning', 'Tomorrow evening', 'Next week']);
    expect(when(new Date(2026, 9, 26, 19).getTime(), now.getTime())).toBe('this evening');
    expect(when(new Date(2026, 9, 27, 9).getTime(), now.getTime())).toBe('tomorrow morning');
    expect(when(new Date(2026, 9, 27, 14, 30).getTime(), now.getTime())).toBe('tomorrow 14:30');
  });
});
