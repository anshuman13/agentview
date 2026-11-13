import { afterEach, describe, expect, it, vi } from 'bun:test';
import { nextClock } from '../../../shared/util.js';
import type { PlanUsage, Repeat } from '../../../shared/protocol.js';
import { ROUND_INSTRUCTION, parseGoal, parseLoop, usageGate } from './repeat.js';
import { setSystemTime } from '../../../testing.js';

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
  afterEach(() => {
    vi.useRealTimers();
    setSystemTime();
  });

  it('picks today when the time is still ahead', () => {
    expect(nextClock(9, 30, now)).toBe(new Date(2026, 9, 24, 9, 30, 0).getTime());
  });

  it('rolls a time already passed, or equal to now, into tomorrow', () => {
    expect(nextClock(8, 0, now)).toBe(new Date(2026, 9, 25, 8, 0, 0).getTime());
    expect(nextClock(9, 0, now)).toBe(new Date(2026, 9, 25, 9, 0, 0).getTime());
  });

  it('crosses midnight', () => {
    vi.useFakeTimers();
    setSystemTime(new Date(2026, 9, 24, 23, 45, 0));
    expect(nextClock(0, 15, Date.now())).toBe(new Date(2026, 9, 25, 0, 15, 0).getTime());
    expect(parseLoop('/loop until 00:15 wrap up')).toMatchObject({ until: new Date(2026, 9, 25, 0, 15, 0).getTime() });
    expect(parseLoop('/loop at 23:50 wrap up')).toMatchObject({ nextAt: new Date(2026, 9, 24, 23, 50, 0).getTime() });
  });
});

describe('parseGoal options', () => {
  const clockAt = (h: number, m: number) => new Date(2026, 9, 24, h, m, 0).getTime();

  it('reads every, until and cap in that order', () => {
    expect(parseGoal('/goal every 1h until 18:00 cap 70% keep CI green', now)).toMatchObject({ every: 3_600_000, endAt: clockAt(18, 0), capPct: 70, goal: 'keep CI green' });
  });

  it('reads until or cap alone, until done', () => {
    expect(parseGoal('/goal until 18:00 tests pass', now)).toMatchObject({ every: 0, until: null, endAt: clockAt(18, 0), goal: 'tests pass' });
    expect(parseGoal('/goal cap 50% tests pass', now)).toMatchObject({ every: 0, capPct: 50, goal: 'tests pass' });
    expect(parseGoal('/goal until 08:00 tests pass', now)).toMatchObject({ endAt: new Date(2026, 9, 25, 8, 0, 0).getTime() });
  });

  it('keeps other until and cap words as the condition', () => {
    expect(parseGoal('/goal until tests pass', now)).toMatchObject({ goal: 'until tests pass' });
    expect(parseGoal('/goal cap 5 retries', now)).toMatchObject({ goal: 'cap 5 retries' });
    expect(parseGoal('/goal every 1h until tests pass', now)).toMatchObject({ every: 3_600_000, goal: 'until tests pass' });
  });

  it('refuses a cap outside 1-100 and options without a condition', () => {
    expect(parseGoal('/goal cap 0% x')).toBe('usage');
    expect(parseGoal('/goal cap 101% x')).toBe('usage');
    expect(parseGoal('/goal cap 70%')).toBe('usage');
    expect(parseGoal('/goal until 25:00 x')).toBe('usage');
  });
});

describe('usageGate', () => {
  const r = (capPct?: number) => ({ prompt: 'p', every: 0, until: null, round: 0, nextAt: null, goal: 'g', capPct }) as Repeat;
  const usage = (week: number, five: number, resetsAt: number | null = null): PlanUsage => ({ week: { pct: week, resetsAt: null }, fiveHour: { pct: five, resetsAt } });

  it('runs under the cap, without a cap or without usage', () => {
    expect(usageGate(r(70), usage(40, 30))).toBeNull();
    expect(usageGate(r(), usage(99, 99))).toBeNull();
    expect(usageGate(r(70), null)).toBeNull();
  });

  it('ends at the weekly cap', () => {
    expect(usageGate(r(70), usage(70, 10))).toEqual({ note: 'Usage cap 70% reached', why: 'Usage cap 70% reached' });
  });

  it('skips while the 5-hour window is over 90%', () => {
    expect(usageGate(r(70), usage(10, 91, now + 1000), now)).toEqual({ skipUntil: now + 1000 });
    expect(usageGate(r(70), usage(10, 91, now - 1000), now)).toBeNull();
    expect(usageGate(r(70), usage(10, 90))).toBeNull();
  });
});

describe('goal prompts', () => {
  it('keep the safety line, GOAL MET and the ROUND wording, and give no push permission', () => {
    const prompts = [(parseGoal('/goal every 1h x') as Repeat).prompt, (parseGoal('/goal x') as Repeat).prompt];
    for (const p of prompts) {
      expect(p).toContain('irreversible or outward-facing');
      expect(p).toContain('GOAL MET');
      expect(p).not.toMatch(/allowed to push|you may push/i);
    }
    expect(ROUND_INSTRUCTION).toContain('first sentence is the push text');
    expect(ROUND_INSTRUCTION).not.toMatch(/allowed to push|you may push/i);
  });
});
