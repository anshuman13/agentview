import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Runs, firstSentence, roundResult } from './runs.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'runs-'));
afterEach(() => rmSync(path.join(dir, 'runs.json'), { force: true }));

const init = { kind: 'loop', sessionId: 's', chatId: 'c', title: 't', what: 'w' } as const;

describe('roundResult', () => {
  it('takes the ROUND line, and without one reports progress with the first sentence', () => {
    expect(roundResult('Done.\nROUND: blocked needs a token')).toEqual({ outcome: 'blocked', line: 'needs a token' });
    expect(roundResult('Fixed the test. Then ran the rest.')).toEqual({ outcome: 'progress', line: 'Fixed the test.' });
    expect(firstSentence(`${'a'.repeat(200)}. b`)).toHaveLength(120);
  });

  it('a failed turn is failed and a met goal is done, whatever the line says', () => {
    expect(roundResult('Turn ended: error_during_execution\nROUND: progress x', { failed: true })).toEqual({ outcome: 'failed', line: 'x' });
    expect(roundResult('GOAL MET\nROUND: progress x', { met: true }).outcome).toBe('done');
  });
});

describe('Runs needsYou', () => {
  const round = (n: number, outcome: 'blocked' | 'progress') => ({ n, outcome, line: '', costUsd: 0 });

  it('is set by a blocked or question round and cleared by a later round or a user message', () => {
    const runs = new Runs();
    const id = runs.start(init);
    runs.addRound(id, round(1, 'blocked'));
    expect(runs.get(id)?.needsYou).toBe(true);
    runs.addRound(id, round(2, 'progress'));
    expect(runs.get(id)?.needsYou).toBe(false);
    runs.addRound(id, round(3, 'blocked'));
    runs.answer('c');
    expect(runs.get(id)?.needsYou).toBe(false);
  });

  it('is set while paused for approval, then falls back to the last round', () => {
    const runs = new Runs();
    const id = runs.start(init);
    runs.addRound(id, round(1, 'blocked'));
    runs.update(id, { state: 'paused', why: 'waiting for your approval' });
    runs.update(id, { state: 'running', why: '' });
    expect(runs.get(id)?.needsYou).toBe(true);
    runs.answer('c');
    runs.update(id, { state: 'paused', why: 'waiting for your approval' });
    expect(runs.get(id)?.needsYou).toBe(true);
    runs.update(id, { state: 'paused', why: 'usage limit until 18:00' });
    expect(runs.get(id)?.needsYou).toBe(false);
    runs.end(id, 'x');
    expect(runs.get(id)?.needsYou).toBe(false);
  });
});

describe('Runs', () => {
  it('keeps active runs, the latest 100 ended ones and the last 50 rounds of each in the file', () => {
    const file = path.join(dir, 'runs.json');
    const runs = new Runs(file);
    const keep = runs.start(init);
    for (let n = 1; n <= 60; n++) runs.addRound(keep, { n, outcome: 'progress', line: `r${n}`, costUsd: 0.5 });
    for (let i = 0; i < 105; i++) runs.end(runs.start(init), `ended ${i}`);
    runs.flush();
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved).toHaveLength(101);
    expect(saved.filter((r: { state: string }) => r.state === 'done')).toHaveLength(100);
    const active = new Runs(file).get(keep)!;
    expect(active.rounds).toHaveLength(50);
    expect(active.rounds[0].n).toBe(11);
    expect(active.costUsd).toBe(30);
    expect(runs.list()).toHaveLength(101);
  });

  it('ends a run once and ignores later changes to it', () => {
    const runs = new Runs();
    const id = runs.start(init);
    runs.end(id, 'you stopped it');
    runs.end(id, 'chat closed');
    runs.addRound(id, { n: 1, outcome: 'done', line: '', costUsd: 1 });
    expect(runs.get(id)).toMatchObject({ state: 'done', why: 'you stopped it', rounds: [], costUsd: 0 });
  });
});
