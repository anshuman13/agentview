import { describe, expect, it } from 'vitest';
import { tryColumn } from './TriesBoard';
import type { ChatRun, LiveChat } from '../../../shared/protocol';

const run = {
  id: 'r', kind: 'tries', sessionId: 'p', chatId: 'pc', title: 'Tries: fix it', what: 'fix it', startedAt: 1, endedAt: null, state: 'running', why: '', round: 0, max: 0, nextAt: null, costUsd: 1.5, needsYou: false,
  tries: [1, 2, 3].map((n) => ({ n, chatId: `c${n}`, sessionId: `s${n}`, branch: `tries/fix-it-${n}`, dropped: n === 3 })),
  rounds: [
    { n: 1, at: 1, outcome: 'done', line: 'Try 1: patched the parser', costUsd: 0.9 },
    { n: 2, at: 2, outcome: 'question', line: 'Try 2: which format?', costUsd: 0.6 },
  ],
} as ChatRun;
const live = [{ id: 'c1', sessionId: 's1', running: false, pending: 0, edits: { add: 12, del: 3 }, cost: 1 }] as LiveChat[];

describe('tries board', () => {
  it('derives a column per try from the run and its live chat', () => {
    expect(tryColumn(run, run.tries![0], live)).toMatchObject({ n: 1, state: { status: 'done' }, line: 'patched the parser', edits: { add: 12, del: 3 }, cost: 1 });
    expect(tryColumn(run, run.tries![1], live)).toMatchObject({ state: { status: 'waiting', label: 'Needs you' }, line: 'which format?', cost: 0.6 });
    expect(tryColumn(run, run.tries![2], live).archived).toBe(true);
  });

});
