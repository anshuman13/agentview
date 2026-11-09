import { describe, expect, it } from 'vitest';
import { lastUserAt, needsYou, runBands } from './runBands';
import type { ChatEvent, ChatRun, Round } from '../../../shared/protocol';
import type { Job } from '../codex/data/wiki';

const round = (n: number, at: number, outcome: Round['outcome'] = 'quiet'): Round => ({ n, at, outcome, line: '', costUsd: 0 });
const run = (id: string, over: Partial<ChatRun> = {}): ChatRun => ({ id, kind: 'loop', sessionId: `s${id}`, chatId: `c${id}`, title: id, what: '', startedAt: 1, endedAt: null, state: 'running', why: '', round: 0, max: 0, nextAt: null, costUsd: 0, rounds: [], ...over });
const job = (id: string) => ({ id, profile: 'work' }) as Job;
const id = (i: { kind: string; run?: ChatRun; job?: Job }) => (i.kind === 'run' ? i.run!.id : i.job!.id);

describe('needsYou', () => {
  it('flags a blocked or question last round and an approval pause', () => {
    expect(needsYou(run('a', { rounds: [round(1, 5, 'blocked')] }))).toBe(true);
    expect(needsYou(run('a', { rounds: [round(1, 5, 'question')] }))).toBe(true);
    expect(needsYou(run('a', { state: 'paused', why: 'waiting for your approval' }))).toBe(true);
    expect(needsYou(run('a', { state: 'paused', why: 'usage limit until 18:00' }))).toBe(false);
  });

  it('clears on a later round or a message from the user after it', () => {
    expect(needsYou(run('a', { rounds: [round(1, 5, 'blocked'), round(2, 9)] }))).toBe(false);
    expect(needsYou(run('a', { rounds: [round(1, 5, 'blocked')] }), 7)).toBe(false);
    expect(needsYou(run('a', { rounds: [round(1, 5, 'blocked')] }), 3)).toBe(true);
    expect(needsYou(run('a', { state: 'done', rounds: [round(1, 5, 'blocked')] }))).toBe(false);
  });

  it('ignores the loop prompts when finding the last message', () => {
    const user = (id: string, at: number, auto?: 'loop'): ChatEvent => ({ id, kind: 'user', text: '', at, auto });
    expect(lastUserAt([user('1', 4), user('2', 8, 'loop')])).toBe(4);
  });
});

describe('runBands', () => {
  it('sorts runs and jobs into the three bands', () => {
    const runs = [run('a', { rounds: [round(1, 5, 'blocked')] }), run('b'), run('c', { state: 'paused' }), run('d', { state: 'done', endedAt: 5 }), run('e', { state: 'done', endedAt: 9 })];
    const jobs = [
      { job: job('f'), state: { status: 'failed' as const } },
      { job: job('g'), state: { status: 'running' as const } },
      { job: job('h'), state: { status: 'waiting' as const, reason: 'Queued' } },
      { job: job('i'), state: { status: 'skipped' as const, reason: 'Off' } },
      { job: job('j'), state: null },
    ];
    const { needs, running, finished } = runBands(runs, jobs, () => 0);
    expect(needs.map(id)).toEqual(['a', 'f']);
    expect(running.map(id)).toEqual(['b', 'c', 'g', 'h']);
    expect(finished.map((r) => r.id)).toEqual(['e', 'd']);
  });

  it('moves a run out of Needs you once the user has written in its chat', () => {
    const runs = [run('a', { rounds: [round(1, 5, 'blocked')] })];
    expect(runBands(runs, [], (chat) => (chat === 'ca' ? 8 : 0)).needs).toHaveLength(0);
  });

  it('keeps the latest 30 finished runs', () => {
    const runs = Array.from({ length: 35 }, (_, i) => run(`r${i}`, { state: 'done', endedAt: i }));
    expect(runBands(runs, [], () => 0).finished).toHaveLength(30);
  });
});
