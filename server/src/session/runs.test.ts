import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { Runs, firstSentence, openTries, roundResult } from './runs.js';

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

  it('is set while a job run waits for review', () => {
    const runs = new Runs();
    const id = runs.start(init);
    runs.update(id, { state: 'paused', why: 'Ready for review', review: 'pending' });
    expect(runs.get(id)?.needsYou).toBe(true);
    runs.update(id, { state: 'running', review: undefined });
    expect(runs.get(id)?.needsYou).toBe(false);
  });

  it('is taken back from review by a user message in its chat', () => {
    const runs = new Runs();
    const id = runs.start({ ...init, kind: 'job' });
    runs.update(id, { state: 'paused', why: 'Ready for review', review: 'pending' });
    runs.answer('c');
    expect(runs.get(id)).toMatchObject({ state: 'running', why: '', needsYou: false });
    expect(runs.get(id)?.review).toBeUndefined();
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

describe('Runs tries', () => {
  const tries = [1, 2, 3].map((n) => ({ n, chatId: `c${n}`, sessionId: `s${n}`, branch: `tries/x-${n}` }));
  const report = { outcome: 'done', line: 'ok', costUsd: 1 } as const;

  it('records each child report as a round of the parent run, prefixed with the try number', () => {
    const runs = new Runs();
    const id = runs.start({ ...init, kind: 'tries', tries });
    runs.reportTry('s2', { ...report, line: 'works' });
    runs.reportTry('other', report);
    expect(runs.get(id)).toMatchObject({ costUsd: 1, rounds: [{ n: 2, line: 'Try 2: works', outcome: 'done' }] });
  });

  it('fires once, when the last try reports', () => {
    const fired: string[] = [];
    const runs = new Runs(null, undefined, undefined, (r) => fired.push(r.id));
    const id = runs.start({ ...init, kind: 'tries', tries });
    runs.reportTry('s1', report);
    runs.reportTry('s2', report);
    expect(fired).toEqual([]);
    runs.reportTry('s3', report);
    runs.reportTry('s3', report);
    expect(fired).toEqual([id]);
  });

  it('keeping a try drops the others and ends the run; send targets skip the dropped', () => {
    const runs = new Runs();
    const id = runs.start({ ...init, kind: 'tries', tries });
    expect(openTries(runs.get(id)!).map((t) => t.n)).toEqual([1, 2, 3]);
    runs.keep(id, 2);
    expect(openTries(runs.get(id)!).map((t) => t.n)).toEqual([2]);
    expect(runs.get(id)).toMatchObject({ state: 'done', why: 'kept try 2' });
  });

  it('a try that stays out does not hold up the comparison', () => {
    const fired: string[] = [];
    const runs = new Runs(null, undefined, undefined, (r) => fired.push(r.id));
    const id = runs.start({ ...init, kind: 'tries', tries: tries.map((t) => (t.n === 3 ? { ...t, dropped: true } : t)) });
    runs.reportTry('s1', report);
    runs.reportTry('s2', report);
    expect(fired).toEqual([id]);
  });
});
