import { describe, expect, it, vi } from 'bun:test';
import { advance, loopOff, needsApproval, verdictOf } from './loop.js';
import { RepeatController, after, parseGoal, parseLoop } from './repeat.js';
import { limitReset } from '../agent/claude/limitText.js';
import type { PlanUsage, Repeat } from '../../../shared/protocol.js';
import { setSystemTime } from '../../../testing.js';

describe('verdictOf', () => {
  it('reads the last verdict line', () => {
    expect(verdictOf('Checked things.\n\nVERDICT: PASS')).toBe('pass');
    expect(verdictOf('**VERDICT: FAIL**\n1. tests fail')).toBe('fail');
    expect(verdictOf('verdict: pass')).toBe('pass');
    expect(verdictOf('VERDICT: FAIL\n...\nVERDICT: PASS')).toBe('pass');
  });

  it('returns null without a verdict', () => {
    expect(verdictOf('All good I think')).toBe(null);
    expect(verdictOf('')).toBe(null);
  });
});

describe('needsApproval', () => {
  it('reads the last approval line', () => {
    expect(needsApproval('1. drop the table\n\nAPPROVAL: NEEDED, deletes data')).toBe(true);
    expect(needsApproval('**APPROVAL: NEEDED**')).toBe(true);
    expect(needsApproval('APPROVAL: NOT NEEDED')).toBe(false);
    expect(needsApproval('APPROVAL: NEEDED\n...\nAPPROVAL: NOT NEEDED')).toBe(false);
    expect(needsApproval('A plan without the line')).toBe(false);
  });
});

describe('advance', () => {
  const on = { ...loopOff(2), on: true, round: 1 };

  it('does nothing when the loop is off or idle', () => {
    expect(advance(loopOff(), 'x').step).toBe(null);
    expect(advance(on, 'x').step).toBe(null);
  });

  it('goes plan, build, test', () => {
    const a = advance({ ...on, phase: 'plan' }, '');
    expect(a.state.phase).toBe('build');
    expect(a.step?.mode).toBe('auto');
    const b = advance(a.state, 'done');
    expect(b.state.phase).toBe('test');
    expect(b.step?.phase).toBe('test');
    expect(b.step?.label).toBe('Test 1/2');
  });

  it('stops when the plan was not approved', () => {
    const r = advance({ ...on, phase: 'plan' }, '', { planDenied: true });
    expect(r.state.phase).toBe('failed');
    expect(r.step).toBe(null);
    expect(r.note).toContain('not approved');
  });

  it('stops when a step failed instead of going to the next one', () => {
    const r = advance({ ...on, phase: 'build' }, '', { failed: true });
    expect(r.state.phase).toBe('failed');
    expect(r.step).toBe(null);
    expect(r.note).toBe('Build cycle stopped: the build step failed');
  });

  it('passes when the tester says so', () => {
    const r = advance({ ...on, phase: 'test' }, 'All checks pass.\nVERDICT: PASS');
    expect(r.state.phase).toBe('passed');
    expect(r.step).toBe(null);
    expect(r.note).toContain('passed');
  });

  it('loops back to build on fail and stops at max', () => {
    const r = advance({ ...on, phase: 'test' }, 'VERDICT: FAIL\n1. npm test fails');
    expect(r.state).toMatchObject({ phase: 'build', round: 2 });
    expect(r.step?.prompt).toContain('npm test fails');
    const t = advance({ ...r.state, phase: 'test' }, 'VERDICT: FAIL\n1. still broken');
    expect(t.state.phase).toBe('failed');
    expect(t.step).toBe(null);
    expect(t.note).toContain('2 rounds');
  });

  it('treats a missing verdict as a failure to fix', () => {
    const r = advance({ ...on, phase: 'test' }, 'Looks fine');
    expect(r.state.phase).toBe('build');
    expect(r.step?.prompt).toContain('no VERDICT line');
  });
});

describe('limitReset', () => {
  const now = new Date(2026, 9, 24, 0, 0, 0).getTime();
  it('reads the reset clock out of a usage limit message', () => {
    expect(limitReset("You've hit your session limit · resets 1:50am (Europe/Oslo)", now)).toBe(new Date(2026, 9, 24, 1, 51, 0).getTime());
    expect(limitReset('Weekly limit reached, resets at 11pm', now)).toBe(new Date(2026, 9, 24, 23, 1, 0).getTime());
    expect(limitReset('limit resets 13:05', now)).toBe(new Date(2026, 9, 24, 13, 6, 0).getTime());
  });
  it('ignores other text', () => {
    expect(limitReset('All 229 tests pass', now)).toBeNull();
    expect(limitReset('rate limit resets Oct 25', now)).toBeNull();
    expect(limitReset('the limit is 5 retries', now)).toBeNull();
    expect(limitReset('Done. I added retries to the client.\n\nNote the API rate limit resets at 5pm, so the sync may lag.', now)).toBeNull();
  });
});

describe('RepeatController', () => {
  it('runs a one-shot loop that came due while Claude was busy', () => {
    vi.useFakeTimers();
    let r = parseLoop('/loop at 01:50 check') as NonNullable<ReturnType<typeof parseLoop>> & object;
    let running = true;
    const sent: string[] = [];
    const c = new RepeatController({
      repeat: () => r as never,
      running: () => running,
      closed: () => false,
      setSession: (p) => { r = (p.repeat ?? null) as never; },
      system: () => {},
      startRun: () => 'run',
      resumeRun: () => 'run',
      endRun: () => {},
      patchRun: () => {},
      usage: () => null,
      asking: () => false,
      reopenRun: () => {},
      sendPrompt: (t) => sent.push(t),
    });
    c.set(r as never);
    setSystemTime((r as { nextAt: number }).nextAt);
    vi.advanceTimersByTime(1);
    setSystemTime(Date.now() + 5 * 60_000);
    running = false;
    c.fire();
    expect(sent).toEqual(['check']);
    vi.useRealTimers();
    setSystemTime();
  });
});

describe('standing goal', () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it('parses /goal every 1h and rejects intervals under 10m', () => {
    expect(parseGoal('/goal every 1h keep CI green', 1000)).toMatchObject({ every: HOUR, goal: 'keep CI green', until: 1000 + 28 * DAY, reportAt: 1000 + 7 * DAY });
    expect(parseGoal('/goal every 30m x')).toMatchObject({ every: 30 * 60_000 });
    expect(parseGoal('/goal every 5m x')).toBe('usage');
    expect(parseGoal('/goal every 169h x')).toBe('usage');
    expect(parseGoal('/goal every 1h')).toBe('usage');
    expect(parseGoal('/goal every bug is fixed')).toMatchObject({ every: 0 });
  });

  function setup(goal: string) {
    vi.useFakeTimers();
    let r = parseGoal(`/goal every 1h ${goal}`) as Repeat;
    const state = { running: false, asking: false, sent: [] as { text: string; report?: boolean }[], ended: '', notes: [] as string[] };
    const c = new RepeatController({
      repeat: () => r,
      running: () => state.running,
      closed: () => false,
      setSession: (p) => { r = p.repeat as Repeat; },
      system: (text) => { state.notes.push(text); },
      startRun: () => 'run',
      resumeRun: () => 'run',
      endRun: (_id, why) => { state.ended = why; },
      reopenRun: () => {},
      patchRun: () => {},
      usage: () => null,
      asking: () => state.asking,
      sendPrompt: (text, _auto, _round, report) => state.sent.push({ text, report }),
    });
    return { c, state, repeat: () => r };
  }

  it('skips a heartbeat while Claude is busy or waiting, records no round and re-arms', () => {
    const { c, state, repeat } = setup('x');
    c.set(repeat());
    expect(state.sent).toHaveLength(1);
    state.running = true;
    vi.advanceTimersByTime(HOUR);
    state.running = false;
    state.asking = true;
    vi.advanceTimersByTime(HOUR);
    expect(state.sent).toHaveLength(1);
    expect(state.notes.slice(-2)).toEqual(['Skipped: still working', 'Skipped: waiting for you']);
    expect(repeat().round).toBe(1);
    state.asking = false;
    vi.advanceTimersByTime(HOUR);
    expect(state.sent).toHaveLength(2);
    expect(c.due).toBe(false);
    c.stop();
    vi.useRealTimers();
  });

  it('runs a heartbeat right after a short round and has no 20 round cap', () => {
    const { c, state, repeat } = setup('x');
    c.set({ ...repeat(), round: 25 });
    vi.advanceTimersByTime(HOUR);
    expect(state.sent).toHaveLength(2);
    expect(repeat().round).toBe(27);
    c.stop();
    vi.useRealTimers();
  });

  it('asks for the weekly report once every 7 days', () => {
    const { c, state, repeat } = setup('x');
    c.set(repeat());
    vi.advanceTimersByTime(7 * DAY - HOUR);
    expect(state.sent.some((s) => s.report)).toBe(false);
    vi.advanceTimersByTime(HOUR);
    expect(state.sent.filter((s) => s.report)).toHaveLength(1);
    vi.advanceTimersByTime(HOUR);
    expect(state.sent.filter((s) => s.report)).toHaveLength(1);
    c.stop();
    vi.useRealTimers();
  });

  it('ends after 28 days with its own reason', () => {
    const { c, state, repeat } = setup('x');
    c.set(repeat());
    expect(state.notes[0]).toBe('Goal every 1 h');
    vi.advanceTimersByTime(28 * DAY);
    expect(state.ended).toBe('Ran for 28 days, start it again to continue');
    expect(repeat()).toBeNull();
    vi.useRealTimers();
  });
});

describe('goal limits and edits', () => {
  const HOUR = 3_600_000;
  const standingGoal = (extra = '') => parseGoal(`/goal every 1h ${extra}x`) as Repeat;

  function host(initial: Repeat, usage: PlanUsage | null = null) {
    if (!vi.isFakeTimers()) vi.useFakeTimers();
    let r: Repeat | null = initial;
    const state = { ended: '', sent: 0, patches: [] as Record<string, unknown>[], notes: [] as string[] };
    const c = new RepeatController({
      repeat: () => r,
      running: () => false,
      closed: () => false,
      setSession: (p) => { r = (p.repeat ?? null) as Repeat | null; },
      system: (text) => { state.notes.push(text); },
      startRun: () => 'run',
      resumeRun: () => 'run',
      endRun: (_id, why) => { state.ended = why; },
      reopenRun: () => {},
      patchRun: (_id, patch) => { state.patches.push(patch); },
      usage: () => usage,
      asking: () => false,
      sendPrompt: () => { state.sent++; },
    });
    return { c, state, repeat: () => r };
  }

  it('ends a goal past its end time before sending a round', () => {
    const r = { ...standingGoal(), endAt: Date.now() - 1000 };
    const { c, state } = host(r);
    c.set(r);
    expect(state.ended).toMatch(/^Stopped at \d\d:\d\d · 0 rounds$/);
    expect(state.sent).toBe(0);
    vi.useRealTimers();
  });

  it('ends at the weekly cap and pauses an until-done goal while the 5-hour window is full', () => {
    const week = host(standingGoal('cap 70% '), { week: { pct: 72, resetsAt: null }, fiveHour: null });
    week.c.set(week.repeat()!);
    expect(week.state.ended).toBe('Usage cap 70% reached');
    const full = host(parseGoal('/goal cap 70% x') as Repeat, { week: { pct: 10, resetsAt: null }, fiveHour: { pct: 95, resetsAt: Date.now() + HOUR } });
    full.c.set(full.repeat()!);
    expect(full.state.sent).toBe(0);
    expect(full.state.patches.at(-1)).toMatchObject({ state: 'paused', nextAt: Date.now() + HOUR });
    full.c.stop();
    vi.useRealTimers();
  });

  it('edits a standing goal: every moves the next round, a null cap clears it', () => {
    const { c, state, repeat } = host(standingGoal('cap 70% '));
    c.set(repeat()!);
    c.edit({ every: 2 * HOUR, capPct: null });
    expect(repeat()).toMatchObject({ every: 2 * HOUR, nextAt: Date.now() + 2 * HOUR });
    expect(repeat()!.capPct).toBeUndefined();
    expect(state.notes.at(-1)).toBe('Goal every 2 h · no cap');
    expect(state.patches.at(-1)).toMatchObject({ every: 2 * HOUR, nextAt: Date.now() + 2 * HOUR, capPct: undefined });
    c.edit({ every: 60_000, endAt: 5 });
    expect(repeat()).toMatchObject({ every: 2 * HOUR, endAt: 5 });
    c.stop();
    vi.useRealTimers();
  });

  it('leaves a loop alone', () => {
    const loop = parseLoop('/loop 10m check') as Repeat;
    const { c, state, repeat } = host(loop);
    c.edit({ every: HOUR, capPct: 70 });
    expect(repeat()).toEqual(loop);
    expect(state.patches).toEqual([]);
    vi.useRealTimers();
  });
});

describe('long waits', () => {
  it('refuses a loop interval over 7 days', () => {
    expect(parseLoop('/loop 169h do it')).toBe('usage');
    expect(parseLoop('/loop 168h do it')).toMatchObject({ every: 168 * 3_600_000 });
  });

  it('after() never hands Node a delay over its clamp and still fires once at the time', () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => (delays.push(ms ?? 0), real(fn, ms))) as typeof setTimeout);
    const fn = vi.fn();
    after(Date.now() + 40 * 24 * 3_600_000, fn);
    vi.advanceTimersByTime(39 * 24 * 3_600_000);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(fn).toHaveBeenCalledOnce();
    expect(Math.max(...delays)).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(delays.length).toBeGreaterThan(1);
    spy.mockRestore();
    vi.useRealTimers();
  });
});
