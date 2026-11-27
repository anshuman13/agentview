import { describe, expect, it } from 'bun:test';
import { burnRate, helperCount, nextStep, parseBuild, taskBrief, untilAt } from './build';

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

describe('burnRate', () => {
  const m = 60_000;
  it('is points per minute since the last reset', () => {
    expect(burnRate([{ at: 0, fiveHour: 10 }, { at: 5 * m }, { at: 10 * m, fiveHour: 20 }])).toBe(1);
    expect(burnRate([{ at: 0, fiveHour: 90 }, { at: 5 * m, fiveHour: 2 }, { at: 10 * m, fiveHour: 7 }])).toBe(1);
  });

  it('is null for samples spanning under 2 minutes', () => {
    expect(burnRate([])).toBeNull();
    expect(burnRate([{ at: 0, fiveHour: 10 }, { at: m, fiveHour: 12 }])).toBeNull();
  });
});

describe('helperCount', () => {
  it('starts the most helpers that keep the projection at the reset under target', () => {
    expect(helperCount({ pct: 20, mins: 30, perAgent: 0.3, weekPct: 20 })).toBe(3);
    expect(helperCount({ pct: 20, mins: 60, perAgent: 0.3, weekPct: 20 })).toBe(2);
  });

  it('starts none for the measured case of 65% with 25 minutes left at 3.5 pts/min across 6 agents', () => {
    expect(helperCount({ pct: 65, mins: 25, perAgent: 3.5 / 6, weekPct: 30 })).toBe(0);
  });

  it('starts none at the weekly cap or without a reset time', () => {
    expect(helperCount({ pct: 10, mins: 60, perAgent: 0.1, weekPct: 60 })).toBe(0);
    expect(helperCount({ pct: 10, mins: null, perAgent: 0.1, weekPct: 20 })).toBe(0);
  });

  it('tries 1 helper at the default rate without samples', () => {
    expect(helperCount({ pct: 50, mins: 10, perAgent: null, weekPct: 20 })).toBe(1);
    expect(helperCount({ pct: 50, mins: 30, perAgent: null, weekPct: 20 })).toBe(0);
  });
});

describe('taskBrief', () => {
  const now = new Date(2026, 10, 27, 12, 0).getTime();
  const at = (h: number, min: number) => new Date(2026, 10, 27, h, min).getTime();

  it('gives the numbers and offers helpers in worktrees while there is room', () => {
    const brief = taskBrief('.claude/specs/x.md', 1, 4, true, { pct: 20, resetsAt: at(12, 30), perAgent: 0.3, weekPct: 20 }, now);
    expect(brief).toStartWith('Build run, task 1 of 4. Read .claude/specs/x.md');
    expect(brief).toContain('5-hour usage 20%, resets 12:30 (30 min), about 0.3 pts/min per agent, weekly 20%: start up to 3 helpers.');
    expect(brief).toContain('isolation "worktree"');
  });

  it('works alone when the projection is over target and says nothing without usage', () => {
    expect(taskBrief('.claude/specs/x.md', 1, 4, true, { pct: 65, resetsAt: at(12, 25), perAgent: 3.5 / 6, weekPct: 30 }, now)).toContain(
      '5-hour usage 65%, resets 12:25 (25 min), about 0.6 pts/min per agent, weekly 30%: work alone',
    );
    expect(taskBrief('.claude/specs/x.md', 1, 4, true)).not.toContain('5-hour');
  });
});
