import { afterEach, describe, expect, it, vi } from 'vitest';
import { ago } from './util';

describe('ago', () => {
  afterEach(() => vi.useRealTimers());

  it('rounds to the largest unit and says now under a minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 12, 0, 0));
    const now = Date.now();
    expect(ago(now - 30_000)).toBe('now');
    expect(ago(now - 5 * 60_000)).toBe('5m');
    expect(ago(now - 3 * 3_600_000, ' ago')).toBe('3h ago');
    expect(ago(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d');
    expect(ago(now - 21 * 86_400_000)).toBe('3w');
    expect(ago('not a date')).toBe('not a date');
  });
});
