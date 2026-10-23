import { describe, expect, it } from 'vitest';
import { advance, loopOff, verdictOf } from './loop.js';
import { limitReset } from './repeat.js';

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
  });
});
