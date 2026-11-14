import { describe, expect, it } from 'bun:test';
import { agentAge, loopNow, loopOpenByDefault, runLine } from './runLogic';
import type { ChatRun } from '../../../shared/protocol';

describe('runLine', () => {
  const run = (over: Partial<ChatRun>) => ({ kind: 'loop', state: 'running', why: '', round: 4, max: 0, nextAt: null, ...over }) as ChatRun;
  it('says the state of each kind of run', () => {
    expect(runLine(run({ nextAt: new Date(2026, 10, 9, 14, 20).getTime() }))).toBe('Loop · round 4 · next 14:20');
    expect(runLine(run({}))).toBe('Loop · round 4');
    expect(runLine(run({ state: 'paused', why: 'usage limit until 18:00' }))).toBe('Paused · usage limit until 18:00');
    expect(runLine(run({ kind: 'goal', round: 3, max: 20 }))).toBe('Goal · round 3 of 20');
    expect(runLine(run({ kind: 'goal', round: 12, every: 3_600_000, nextAt: new Date(2026, 10, 9, 14, 20).getTime() }))).toBe('Goal · round 12 · next 14:20');
    expect(runLine(run({ kind: 'goal', round: 3, every: 3_600_000 }))).toBe('Goal · round 3');
    expect(runLine(run({ kind: 'job', branch: 'jobs/fix-1105' }))).toBe('Job · jobs/fix-1105');
    expect(runLine(run({ kind: 'cycle', round: 2, max: 3 }), 'test')).toBe('Build cycle · round 2/3 · Test');
    expect(runLine(run({ kind: 'cycle', round: 2, max: 3 }), 'passed')).toBe('Build cycle · round 2/3');
  });
});

describe('loopOpenByDefault', () => {
  const run = (needsYou: boolean) => ({ needsYou, rounds: [] }) as unknown as ChatRun;
  it('opens the loop card by default only when working, waiting or needing you', () => {
    expect(loopOpenByDefault(run(true), false, false)).toBe(true);
    expect(loopOpenByDefault(run(false), false, true)).toBe(true);
    expect(loopOpenByDefault(run(false), true, false)).toBe(true);
    expect(loopOpenByDefault(run(false, 'progress'), false, false)).toBe(false);
    expect(loopOpenByDefault({ ...run(false), state: 'paused' } as ChatRun, false, false)).toBe(false);
    expect(loopOpenByDefault({ ...run(false), state: 'done' } as ChatRun, false, false)).toBe(false);
  });
});

describe('loopNow', () => {
  const run = (rounds: { at: number; line: string }[], startedAt = 100) => ({ startedAt, nextAt: null, rounds: rounds.map((r) => ({ n: 1, outcome: 'progress', costUsd: 0, ...r })) }) as unknown as ChatRun;
  it('takes the newer of the status and the last round, and ignores a status from before the run', () => {
    expect(loopNow(run([{ at: 200, line: 'round' }]), { text: 'Working', at: 300, next: ['a', 'b'] })).toMatchObject({ source: 'status', title: 'Working', next: 'a', stepsLeft: 2 });
    expect(loopNow(run([{ at: 400, line: 'round' }]), { text: 'Working', at: 300 })).toMatchObject({ source: 'round', title: expect.stringMatching(/^Round 1 · \d\d:\d\d · progress: round$/) });
    expect(loopNow(run([]), { text: 'Old', at: 50 })).toMatchObject({ source: 'none', title: 'First round' });
  });
  it('words agent ages', () => {
    expect(agentAge(0, 5_000)).toBe('1 min');
    expect(agentAge(0, 12 * 60_000)).toBe('12 min');
    expect(agentAge(0, 65 * 60_000)).toBe('1 h 5 min');
  });
});
