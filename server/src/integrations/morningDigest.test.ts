import { describe, expect, it } from 'bun:test';
import type { ChatRun } from '../../../shared/protocol.js';
import { eveningBefore, morningDigest } from './morningDigest.js';

const run = (p: Partial<ChatRun>): ChatRun => ({ id: 'r', kind: 'job', sessionId: 's', chatId: 'c', title: 'Chat', what: '', startedAt: 0, endedAt: null, state: 'running', why: '', round: 1, max: 0, nextAt: null, costUsd: 1.234, rounds: [], needsYou: false, ...p });
const round = (at: number, line: string) => ({ n: 1, at, outcome: 'progress' as const, line, costUsd: 0 });

describe('morningDigest', () => {
  it('skips when no run moved since', () => {
    expect(morningDigest([run({ endedAt: 5, state: 'done', rounds: [round(5, 'x')] })], 10)).toBeNull();
  });

  it('lists runs with line, cost and needs you', () => {
    const d = morningDigest([run({ title: 'A', rounds: [round(20, 'tests green')] }), run({ title: 'B', state: 'done', endedAt: 30, why: 'Goal met', rounds: [round(25, 'x')] }), run({ title: 'C', needsYou: true, rounds: [round(20, 'blocked on key')] })], 10)!;
    expect(d.title).toBe('Overnight: 3 runs, 1 needs you');
    expect(d.body).toBe('A: tests green, $1.23\nB: Goal met, $1.23\nC: blocked on key, $1.23, needs you');
  });

  it('uses singular and omits the needs part', () => {
    expect(morningDigest([run({ rounds: [round(20, 'x')] })], 10)!.title).toBe('Overnight: 1 run');
  });
});

describe('eveningBefore', () => {
  it('is 20:00 the day before', () => {
    const t = new Date(eveningBefore(new Date(2026, 10, 20, 8, 0)));
    expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([19, 20, 0]);
  });
});
