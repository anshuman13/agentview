import { describe, expect, it } from 'bun:test';
import { firstRound, goalCapReached, goalMet, goalNotMet, goalPlan, goalStoppedAt, interval, nextRound, roundText, runLine, skipText } from './goalText';
import { clock } from './util';

const at = new Date(2026, 10, 9, 9, 0).getTime();
const t = new Date(2026, 10, 9, 2, 10).getTime();

describe('goalText', () => {
  it('words the start and edit note with the parts that are set', () => {
    expect(goalPlan({ every: 600_000, endAt: at, capPct: 100 })).toBe('Goal every 10 min until 09:00 · cap 100%');
    expect(goalPlan({ every: 7_200_000 })).toBe('Goal every 2 h');
    expect(goalPlan({ every: 0 })).toBe('Goal when idle · up to 20 rounds');
    expect(goalPlan({ every: 0, capPct: 70 })).toBe('Goal when idle · up to 20 rounds · cap 70%');
    expect(goalPlan({ every: 1_800_000, endAt: at }, true)).toBe('Goal every 30 min until 09:00 · no cap · no build limit');
    expect(goalPlan({ every: 1_800_000, capPct: 70, maxBuilds: 5 }, true)).toBe('Goal every 30 min · cap 70% · builds 5');
    expect(interval(5_400_000)).toBe('90 min');
  });

  it('words the run line, a round and the waits', () => {
    expect(runLine('Goal', { round: 12, max: 0, nextAt: t })).toBe('Goal · round 12 · next 02:10');
    expect(runLine('Goal', { round: 3, max: 20, nextAt: null })).toBe('Goal · round 3 of 20');
    expect(roundText({ n: 4, at: t, outcome: 'progress', line: 'merged X' })).toBe('Round 4 · 02:10 · progress: merged X');
    expect(roundText({ n: 4, at: t, outcome: 'progress', line: '' })).toBe('Round 4 · 02:10 · progress');
    expect(roundText({ n: 4, at: t, outcome: 'quiet', line: 'x' })).toBe('Round 4 · 02:10 · nothing to do');
    expect(roundText({ n: 4, at: t, outcome: 'failed', line: 'boom' })).toBe('Round 4 · 02:10 · failed: boom');
    expect(firstRound(t)).toBe('First round 02:10');
    expect(nextRound(t)).toBe('Next round 02:10');
    expect(nextRound(null)).toBe('Next round');
    expect(skipText('still working')).toBe('Skipped: still working');
  });

  it('words each end, with the singular and an optional commit count', () => {
    expect(goalMet(12)).toBe('Goal met after 12 rounds');
    expect(goalMet(1)).toBe('Goal met after 1 round');
    expect(goalStoppedAt(at, 41, 12)).toBe(`Stopped at ${clock(at)} · 41 rounds · 12 commits`);
    expect(goalStoppedAt(at, 1, 1)).toBe('Stopped at 09:00 · 1 round · 1 commit');
    expect(goalStoppedAt(at, 41, 0)).toBe('Stopped at 09:00 · 41 rounds');
    expect(goalCapReached(100)).toBe('Usage cap 100% reached');
    expect(goalNotMet(20)).toBe('Not met after 20 rounds');
  });
});
