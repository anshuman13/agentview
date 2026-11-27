import { describe, expect, it } from 'bun:test';
import { nextStep, parseBuild, untilAt } from './build';

describe('parseBuild', () => {
  it('reads auto, until and a request or spec path', () => {
    expect(parseBuild('/build add dark mode')).toEqual({ auto: false, until: null, spec: null, request: 'add dark mode' });
    expect(parseBuild('/build auto until 6:00 fix bugs')).toEqual({ auto: true, until: '06:00', spec: null, request: 'fix bugs' });
    expect(parseBuild('/build until 9:00')).toEqual({ auto: false, until: '09:00', spec: null, request: '' });
    expect(parseBuild('/build until 21:30 .claude/specs/scan.md')).toEqual({ auto: false, until: '21:30', spec: '.claude/specs/scan.md', request: '' });
    expect(parseBuild('/build')).toBe('usage');
    expect(parseBuild('/builder x')).toBeNull();
    expect(parseBuild('build it')).toBeNull();
  });
});

describe('untilAt', () => {
  it('is today when the time is still ahead, else tomorrow', () => {
    const now = new Date(2026, 10, 25, 20, 0).getTime();
    expect(untilAt('21:00', now)).toBe(new Date(2026, 10, 25, 21, 0).getTime());
    expect(untilAt('06:00', now)).toBe(new Date(2026, 10, 26, 6, 0).getTime());
  });
});

describe('nextStep', () => {
  const base = { pausing: false, asked: false, failed: false, auto: false, open: 2, until: null, idle: 0, weekPct: 10, now: 1000 };
  it('takes the next task while tasks are open', () => expect(nextStep(base).kind).toBe('task'));
  it('pauses for you on a blocked task unless auto', () => {
    expect(nextStep({ ...base, asked: true })).toEqual({ kind: 'pause', why: 'Needs you: a task is blocked' });
    expect(nextStep({ ...base, asked: true, auto: true }).kind).toBe('task');
  });
  it('pauses when you asked, before anything else', () => expect(nextStep({ ...base, pausing: true, asked: true }).why).toBe('Paused by you'));
  it('finds more work until the stop time, then recaps', () => {
    expect(nextStep({ ...base, open: 0, until: 5000 }).kind).toBe('more');
    expect(nextStep({ ...base, open: 0, until: 5000, idle: 2 }).kind).toBe('recap');
    expect(nextStep({ ...base, until: 500 })).toEqual({ kind: 'recap', why: expect.stringContaining('reached') });
    expect(nextStep({ ...base, open: 0 })).toEqual({ kind: 'recap', why: 'all tasks done' });
  });
  it('recaps at the weekly cap', () => expect(nextStep({ ...base, weekPct: 60 }).kind).toBe('recap'));
});
