import { describe, expect, it } from 'bun:test';
import { askLine, loopNow, runLine, sendsAt } from './runLogic';
import type { ChatRun, LiveChat } from '../../../shared/protocol';

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
  });
});

describe('askLine', () => {
  const run = (over: Partial<NonNullable<LiveChat['run']>>) => ({ id: 'r', kind: 'goal', state: 'running', nextAt: null, round: 2, needsYou: true, outcome: 'question', line: 'Ship it?', ...over }) as LiveChat['run'];
  it('gives the sentence only for a waiting question or blocked round', () => {
    expect(askLine(run({}))).toBe('Ship it?');
    expect(askLine(run({ outcome: 'blocked' }))).toBe('Ship it?');
    expect(askLine(run({ outcome: 'progress' }))).toBeUndefined();
    expect(askLine(run({ outcome: 'done' }))).toBeUndefined();
    expect(askLine(run({ needsYou: false }))).toBeUndefined();
    expect(askLine(run({ line: undefined }))).toBeUndefined();
    expect(askLine(undefined)).toBeUndefined();
  });
});

describe('sendsAt', () => {
  const at = new Date(2026, 10, 9, 22, 0).getTime();
  const run = (over: Partial<ChatRun>) => ({ kind: 'loop', state: 'running', why: '', round: 0, max: 0, nextAt: at, once: true, ...over }) as ChatRun;
  it('names a one-shot loop that has not fired yet', () => {
    expect(runLine(run({}))).toBe('Sends at 22:00');
    expect(sendsAt(run({ round: 1 }))).toBeNull();
    expect(sendsAt(run({ once: undefined }))).toBeNull();
    expect(sendsAt(run({ state: 'paused' }))).toBeNull();
  });
});

describe('loopNow', () => {
  const run = (rounds: { at: number; line: string }[], startedAt = 100) => ({ startedAt, nextAt: null, rounds: rounds.map((r) => ({ n: 1, outcome: 'progress', costUsd: 0, ...r })) }) as unknown as ChatRun;
  it('takes the newer of the status and the last round, and ignores a status from before the run', () => {
    expect(loopNow(run([{ at: 200, line: 'round' }]), { text: 'Working', at: 300, next: ['a', 'b'] })).toMatchObject({ source: 'status', title: 'Working', next: 'a', stepsLeft: 2 });
    expect(loopNow(run([{ at: 400, line: 'round' }]), { text: 'Working', at: 300 })).toMatchObject({ source: 'round', title: expect.stringMatching(/^Round 1 · \d\d:\d\d · progress: round$/) });
    expect(loopNow(run([]), { text: 'Old', at: 50 })).toMatchObject({ source: 'none', title: 'First round' });
  });
});
