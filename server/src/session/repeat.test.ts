import { afterEach, describe, expect, it, vi } from 'bun:test';
import { nextClock } from '../../../shared/util.js';
import type { FiveHour, PlanUsage, Repeat } from '../../../shared/protocol.js';
import { goalCommand } from '../../../shared/goalForm.js';
import { ROUND_INSTRUCTION, parseGoal, parseLoop, costGate, usageGate, holdsUntil, timedPrompt } from './repeat.js';
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

  it('reads a dollar cap beside a percent cap', () => {
    expect(parseGoal('/goal cap $5 tests pass', now)).toMatchObject({ capUsd: 5, goal: 'tests pass' });
    expect(parseGoal('/goal cap 70% cap $5 tests pass', now)).toMatchObject({ capPct: 70, capUsd: 5, goal: 'tests pass' });
    expect(parseGoal('/goal cap $0 x')).toBe('usage');
    expect(parseGoal('/goal cap $5')).toBe('usage');
  });

  it('reads a 5-hour pause after the cap', () => {
    expect(parseGoal('/goal until 09:00 5h 95% tests pass', now)).toMatchObject({ fiveHour: 95, goal: 'tests pass' });
    expect(parseGoal('/goal cap 70% 5h auto cap $5 tests pass', now)).toMatchObject({ capPct: 70, fiveHour: 'auto', capUsd: 5, goal: 'tests pass' });
    expect(parseGoal('/goal 5h automation works', now)).toMatchObject({ goal: '5h automation works' });
    expect(parseGoal('/goal 5h 0% x')).toBe('usage');
    expect(parseGoal('/goal 5h 101% x')).toBe('usage');
    expect(parseGoal('/goal 5h auto')).toBe('usage');
  });

  it('round-trips the goal line through the start sheet form', () => {
    const r = parseGoal('/goal every 1h cap 70% 5h auto builds 5 tests pass', now) as Repeat;
    expect(goalCommand({ what: r.goal!, every: r.every, stopIn: null, stopAt: null, capPct: r.capPct!, fiveHour: r.fiveHour, builds: r.maxBuilds! }, now)).toBe('/goal every 1h cap 70% 5h auto builds 5 tests pass');
  });

  it('refuses a cap outside 1-100 and options without a condition', () => {
    expect(parseGoal('/goal cap 0% x')).toBe('usage');
    expect(parseGoal('/goal cap 101% x')).toBe('usage');
    expect(parseGoal('/goal cap 70%')).toBe('usage');
    expect(parseGoal('/goal until 25:00 x')).toBe('usage');
  });
});

describe('costGate', () => {
  const r = (capUsd?: number) => ({ prompt: 'p', every: 0, until: null, round: 0, nextAt: null, goal: 'g', capUsd }) as Repeat;

  it('ends the goal once its run cost reaches the cap', () => {
    expect(costGate(r(5), 4.99)).toBeNull();
    expect(costGate(r(5), 5)).toEqual({ note: 'Stopped at $5' });
    expect(costGate(r(), 100)).toBeNull();
  });
});

describe('usageGate', () => {
  const r = (capPct?: number, fiveHour?: FiveHour) => ({ prompt: 'p', every: 0, until: null, round: 0, nextAt: null, goal: 'g', capPct, fiveHour }) as Repeat;
  const usage = (week: number, five: number, resetsAt: number | null = null): PlanUsage => ({ week: { pct: week, resetsAt: null }, fiveHour: { pct: five, resetsAt } });
  const H = 3_600_000;

  it('runs under the cap, without a cap or 5-hour value, or without usage', () => {
    expect(usageGate(r(70), usage(40, 30))).toBeNull();
    expect(usageGate(r(), usage(99, 99, now + H), now)).toBeNull();
    expect(usageGate(r(70), null)).toBeNull();
    expect(usageGate(r(undefined, 'auto'), null)).toBeNull();
  });

  it('ends at the weekly cap', () => {
    expect(usageGate(r(70), usage(70, 10))).toEqual({ note: 'Usage cap 70% reached' });
  });

  it('skips while the 5-hour window is over 90% with a cap and no value of its own', () => {
    expect(usageGate(r(70), usage(10, 91, now + 1000), now)).toEqual({ skipUntil: now + 1000, why: '5-hour usage over 90%' });
    expect(usageGate(r(70), usage(10, 91, now - 1000), now)).toBeNull();
    expect(usageGate(r(70), usage(10, 90))).toBeNull();
  });

  it('skips over a 5-hour percent of its own, with or without a cap', () => {
    expect(usageGate(r(undefined, 95), usage(10, 96, now + H), now)).toEqual({ skipUntil: now + H, why: '5-hour usage over 95%' });
    expect(usageGate(r(70, 95), usage(10, 94, now + H), now)).toBeNull();
    expect(usageGate(r(undefined, 50), usage(10, 60), now)).toEqual({ skipUntil: null, why: '5-hour usage over 50%' });
  });

  it('auto lets the first round run early in the window and waits until the elapsed share catches up', () => {
    const resetsAt = now + 4.5 * H;
    expect(usageGate(r(undefined, 'auto'), usage(10, 8, resetsAt), now)).toBeNull();
    expect(usageGate(r(undefined, 'auto'), usage(10, 30, resetsAt), now)).toEqual({ skipUntil: now + H, why: 'pacing the 5-hour window' });
  });

  it('auto late in the window runs up to the elapsed share and waits for the reset near the top', () => {
    const resetsAt = now + 0.5 * H;
    expect(usageGate(r(undefined, 'auto'), usage(10, 85, resetsAt), now)).toBeNull();
    expect(usageGate(r(undefined, 'auto'), usage(10, 95, resetsAt), now)).toEqual({ skipUntil: now + 0.25 * H, why: 'pacing the 5-hour window' });
    expect(usageGate(r(undefined, 'auto'), usage(10, 98, resetsAt), now)).toEqual({ skipUntil: resetsAt, why: 'pacing the 5-hour window' });
  });

  it('ignores a stale window or one without a reset under auto', () => {
    expect(usageGate(r(undefined, 'auto'), usage(10, 99, now - 1000), now)).toBeNull();
    expect(usageGate(r(undefined, 95), usage(10, 99, now - 1000), now)).toBeNull();
    expect(usageGate(r(undefined, 'auto'), usage(10, 99, null), now)).toBeNull();
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

describe('goals with an end time', () => {
  it('keep running until the end time, even after GOAL MET', () => {
    const now = new Date(2026, 10, 25, 9, 0).getTime();
    const g = parseGoal('/goal every 10m until 21:00 cap 60% ship the briefs', now) as Repeat;
    expect(holdsUntil(g, now)).toBe(true);
    expect(holdsUntil(g, g.endAt! + 1)).toBe(false);
    expect(timedPrompt(g, now)).toContain('runs until 21:00');
    expect(timedPrompt(g, now)).not.toContain('GOAL MET');
    expect(timedPrompt(g, g.endAt! + 1)).toBe(g.prompt);
    expect(holdsUntil(parseGoal('/goal ship the briefs', now) as Repeat, now)).toBe(false);
  });
});

describe('goalMet', () => {
  it('counts GOAL MET only as its own sentence at the end of a line', async () => {
    const { goalMet } = await import('./repeat.js');
    expect(goalMet('All green. GOAL MET')).toBe(true);
    expect(goalMet('Done.\nGOAL MET\nROUND: done x')).toBe(true);
    expect(goalMet('It keeps running even if I reply GOAL MET, so it cannot stop early.')).toBe(false);
    expect(goalMet('Never reply GOAL MET today')).toBe(false);
  });
});
