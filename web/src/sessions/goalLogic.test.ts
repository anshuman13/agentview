import { describe, expect, it } from 'bun:test';
import { goalBadge, stopAtMs, usageLine } from './goalLogic';
import type { ChatRun } from '../../../shared/protocol';

const run = (over: Partial<ChatRun> = {}): ChatRun => ({ id: 'a', kind: 'goal', sessionId: 's', chatId: 'c', title: 'a', what: '', startedAt: 1, endedAt: null, state: 'running', why: '', round: 0, max: 0, nextAt: null, costUsd: 0, rounds: [], needsYou: false, ...over });

describe('goalBadge', () => {
  it('names each state with one badge', () => {
    expect(goalBadge(run()).status).toBe('running');
    expect(goalBadge(run({ needsYou: true }))).toEqual({ status: 'waiting', label: 'Needs you' });
    expect(goalBadge(run({ state: 'paused', why: 'you paused it' }))).toEqual({ status: 'waiting', reason: 'you paused it' });
    expect(goalBadge(run({ state: 'done', why: 'Goal met after 12 rounds' })).status).toBe('done');
    expect(goalBadge(run({ state: 'done', why: 'Stopped at 09:00 · 41 rounds' })).status).toBe('done');
    expect(goalBadge(run({ state: 'done', why: 'Usage cap 100% reached' })).status).toBe('done');
    expect(goalBadge(run({ state: 'done', why: 'Ran for 28 days, start it again to continue' })).status).toBe('done');
    expect(goalBadge(run({ state: 'done', why: 'Not met after 20 rounds' })).status).toBe('failed');
    expect(goalBadge(run({ state: 'done', why: 'goal met' })).status).toBe('done');
    expect(goalBadge(run({ state: 'done', why: 'end time 18:00' })).status).toBe('done');
    expect(goalBadge(run({ state: 'done', why: 'weekly usage cap' })).status).toBe('done');
    expect(goalBadge(run({ state: 'done', why: 'ran for 28 days, start it again to continue' })).status).toBe('done');
    expect(goalBadge(run({ state: 'done', why: 'you stopped it' })).status).toBe('skipped');
    expect(goalBadge(run({ state: 'done', why: 'goal not met' })).status).toBe('failed');
  });
});

describe('stopAtMs', () => {
  const now = new Date(2026, 10, 10, 20, 0).getTime();
  it('counts from now or to the next clock time', () => {
    expect(stopAtMs({}, now)).toBeNull();
    expect(stopAtMs({ stopIn: 3_600_000 }, now)).toBe(now + 3_600_000);
    expect(stopAtMs({ stopAt: '07:00' }, now)).toBe(new Date(2026, 10, 11, 7, 0).getTime());
  });
});

describe('usageLine', () => {
  it('reads the week against the cap and the 5-hour window', () => {
    expect(usageLine(run({ capPct: 70, usage: { week: { pct: 42, resetsAt: null }, fiveHour: { pct: 30, resetsAt: null } } }))).toBe('Week 42% of 70% cap · 5-hour 30%');
    expect(usageLine(run({ capPct: 70 }))).toBe('70% cap');
    expect(usageLine(run())).toBe('No cap');
    expect(usageLine(run({ capPct: 70, maxBuilds: 5, builds: 2, usage: { week: { pct: 42, resetsAt: null } } }))).toBe('Week 42% of 70% cap · Builds 2 of 5');
    expect(usageLine(run({ capPct: 70, maxBuilds: 5, builds: 2 }))).toBe('70% cap · Builds 2 of 5');
    expect(usageLine(run({ maxBuilds: 5, builds: 2 }))).toBe('Builds 2 of 5');
  });
});
