import { describe, expect, it } from 'vitest';
import { runBands } from './runBands';
import type { ChatRun } from '../../../shared/protocol';
import type { Job } from '../codex/data/wiki/wiki';

const run = (id: string, over: Partial<ChatRun> = {}): ChatRun => ({ id, kind: 'loop', sessionId: `s${id}`, chatId: `c${id}`, title: id, what: '', startedAt: 1, endedAt: null, state: 'running', why: '', round: 0, max: 0, nextAt: null, costUsd: 0, rounds: [], needsYou: false, ...over });
const job = (id: string) => ({ id, profile: 'work' }) as Job;
const id = (i: { kind: string; run?: ChatRun; job?: Job }) => (i.kind === 'run' ? i.run!.id : i.job!.id);

describe('runBands', () => {
  it('sorts runs and jobs into the three bands', () => {
    const runs = [run('a', { needsYou: true }), run('b'), run('c', { state: 'paused' }), run('d', { state: 'done', endedAt: 5 }), run('e', { state: 'done', endedAt: 9 })];
    const jobs = [
      { job: job('f'), state: { status: 'failed' as const } },
      { job: job('g'), state: { status: 'running' as const } },
      { job: job('h'), state: { status: 'waiting' as const, reason: 'Queued' } },
      { job: job('i'), state: { status: 'skipped' as const, reason: 'Off' } },
      { job: job('j'), state: null },
    ];
    const { needs, running, finished } = runBands(runs, jobs);
    expect(needs.map(id)).toEqual(['a', 'f']);
    expect(running.map(id)).toEqual(['b', 'c', 'g', 'h']);
    expect(finished.map((r) => r.id)).toEqual(['e', 'd']);
  });

  it('keeps the latest 30 finished runs', () => {
    const runs = Array.from({ length: 35 }, (_, i) => run(`r${i}`, { state: 'done', endedAt: i }));
    expect(runBands(runs, []).finished).toHaveLength(30);
  });
});
