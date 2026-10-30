import { describe, expect, it, vi } from 'vitest';
import { advance, loopOff, needsApproval, verdictOf } from './loop.js';
import { RepeatController, after, limitReset, parseLoop } from './repeat.js';

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
    expect(b.step?.model).toContain('sonnet');
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
    expect(r.note).toBe('Loop stopped: the build step failed');
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
      sendPrompt: (t) => sent.push(t),
    });
    c.set(r as never);
    vi.setSystemTime((r as { nextAt: number }).nextAt);
    vi.advanceTimersByTime(1);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    running = false;
    c.fire();
    expect(sent).toEqual(['check']);
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
