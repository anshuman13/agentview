import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextClock, parseLoop } from './repeat.js';

const now = new Date(2026, 9, 24, 9, 0, 0).getTime();

describe('parseLoop', () => {
  it('reads an interval in minutes or hours', () => {
    expect(parseLoop('/loop 10m check the build', now)).toEqual({ prompt: 'check the build', every: 600_000, until: null, round: 0, nextAt: null });
    expect(parseLoop('/loop every 2h check the build', now)).toMatchObject({ every: 7_200_000, prompt: 'check the build' });
    expect(parseLoop('/loop 5 min check', now)).toMatchObject({ every: 300_000 });
  });

  it('reads an end time with or without an interval', () => {
    const until = new Date(2026, 9, 24, 17, 30, 0).getTime();
    expect(parseLoop('/loop until 17:30 keep going', now)).toEqual({ prompt: 'keep going', every: 0, until, round: 0, nextAt: null });
    expect(parseLoop('/loop 30m until 17:30 keep going', now)).toMatchObject({ every: 1_800_000, until });
  });

  it('turns a loop off', () => {
    expect(parseLoop('/loop off')).toBe('off');
    expect(parseLoop('/loop stop')).toBe('off');
  });

  it('refuses a loop without an interval or end time', () => {
    expect(parseLoop('/loop')).toBe('usage');
    expect(parseLoop('/loop do the thing')).toBe('usage');
    expect(parseLoop('/loop 10m')).toBe('usage');
    expect(parseLoop('/loop 10x do the thing')).toBe('usage');
  });

  it('ignores other messages', () => {
    expect(parseLoop('hello')).toBeNull();
    expect(parseLoop('/loopy 10m x')).toBeNull();
  });
});

describe('nextClock', () => {
  afterEach(() => vi.useRealTimers());

  it('picks today when the time is still ahead', () => {
    expect(nextClock(9, 30, now)).toBe(new Date(2026, 9, 24, 9, 30, 0).getTime());
  });

  it('rolls a time already passed, or equal to now, into tomorrow', () => {
    expect(nextClock(8, 0, now)).toBe(new Date(2026, 9, 25, 8, 0, 0).getTime());
    expect(nextClock(9, 0, now)).toBe(new Date(2026, 9, 25, 9, 0, 0).getTime());
  });

  it('crosses midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 23, 45, 0));
    expect(nextClock(0, 15, Date.now())).toBe(new Date(2026, 9, 25, 0, 15, 0).getTime());
    expect(parseLoop('/loop until 00:15 wrap up')).toMatchObject({ until: new Date(2026, 9, 25, 0, 15, 0).getTime() });
    expect(parseLoop('/loop at 23:50 wrap up')).toMatchObject({ nextAt: new Date(2026, 9, 24, 23, 50, 0).getTime() });
  });
});
