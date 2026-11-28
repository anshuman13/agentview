import { describe, expect, it } from 'bun:test';
import { askLine, loopNow, runLine } from './runLogic';
import type { ChatRun, LiveChat } from '../../../shared/protocol';

describe('runLine', () => {
  const run = (over: Partial<ChatRun>) => ({ kind: 'job', state: 'running', why: '', round: 0, max: 0, nextAt: null, ...over }) as ChatRun;
  it('says the state of each kind of run', () => {
    expect(runLine(run({ state: 'paused', why: 'usage limit until 18:00' }))).toBe('Paused · usage limit until 18:00');
    expect(runLine(run({ branch: 'jobs/fix-1105' }))).toBe('Job · jobs/fix-1105');
    expect(runLine(run({ kind: 'tries', tries: [] }))).toBe('Tries · 0 chats');
  });
});

describe('askLine', () => {
  const run = (over: Partial<NonNullable<LiveChat['run']>>) => ({ id: 'r', kind: 'job', state: 'running', nextAt: null, round: 2, needsYou: true, outcome: 'question', line: 'Ship it?', ...over }) as LiveChat['run'];
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

describe('loopNow', () => {
  const run = (rounds: { at: number; line: string }[], startedAt = 100) => ({ startedAt, nextAt: null, rounds: rounds.map((r) => ({ n: 1, outcome: 'progress', ...r })) }) as unknown as ChatRun;
  it('takes the newer of the status and the last round, and ignores a status from before the run', () => {
    expect(loopNow(run([{ at: 200, line: 'round' }]), { text: 'Working', at: 300, next: ['a', 'b'] })).toMatchObject({ source: 'status', title: 'Working', next: 'a', stepsLeft: 2 });
    expect(loopNow(run([{ at: 400, line: 'round' }]), { text: 'Working', at: 300 })).toMatchObject({ source: 'round', title: expect.stringMatching(/^Round 1 · \d\d:\d\d · progress: round$/) });
    expect(loopNow(run([]), { text: 'Old', at: 50 })).toMatchObject({ source: 'none', title: 'First round' });
  });
});
