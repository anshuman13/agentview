import { expect, test } from 'bun:test';
import { openDb, getMeta } from './db.js';
import { recordSpend, spendSummary } from './claude.js';
import { DAY } from './time.js';

const use = (costUSD: number) => ({ inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD });

test('spend adds up per model by day, sums today and 7 days, and drops days past 30', () => {
  const db = openDb(':memory:');
  const now = new Date(2026, 10, 5, 12).getTime();
  recordSpend(db, { 'claude-haiku-4-5': use(0.01) }, now - 40 * DAY);
  recordSpend(db, { 'claude-sonnet-5-5': use(0.5) }, now - 3 * DAY);
  recordSpend(db, { 'claude-sonnet-5-5': use(0.2), 'claude-haiku-4-5': use(0.05) }, now);
  const s = spendSummary(db, now);
  expect(s.today.usd).toBeCloseTo(0.25);
  expect(s.week.models.map((m) => [m.model, m.runs])).toEqual([['claude-sonnet-5-5', 2], ['claude-haiku-4-5', 1]]);
  expect(s.week.models[0].tokens).toBe(300);
  expect(getMeta(db, 'spend:2026-09-26')).toBeNull();
});

test('job spend adds up per job id, sums 7 days, and drops days past 30', () => {
  const db = openDb(':memory:');
  const now = new Date(2026, 10, 5, 12).getTime();
  recordSpend(db, { a: use(0.3), b: use(0.1) }, now - 40 * DAY, 'old');
  recordSpend(db, { a: use(0.2) }, now - 8 * DAY, 'stale');
  recordSpend(db, { a: use(0.2) }, now - 3 * DAY, 'j1');
  recordSpend(db, { a: use(0.3), b: use(0.1) }, now, 'j1');
  recordSpend(db, { a: use(0.5) }, now);
  const s = spendSummary(db, now);
  expect(s.week.jobs.j1).toBeCloseTo(0.6);
  expect(Object.keys(s.week.jobs)).toEqual(['j1']);
  expect(JSON.parse(getMeta(db, 'jobspend:2026-11-05')!).j1.runs).toBe(1);
  expect(getMeta(db, 'jobspend:2026-09-26')).toBeNull();
  expect(getMeta(db, 'jobspend:2026-10-28')).not.toBeNull();
  expect(spendSummary(openDb(':memory:'), now).week.jobs).toEqual({});
});
