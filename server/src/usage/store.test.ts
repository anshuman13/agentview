import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { STATE_DIR } from '../agent/claude/accounts.js';
import { closeStore, getMeta, latestSample, samplesSince, saveCall, saveCalls, saveSample, setMeta, tokensByDay, type CallRow } from './store.js';

const reset = () => {
  closeStore();
  for (const f of ['usage.db', 'usage.db-wal', 'usage.db-shm']) rmSync(path.join(STATE_DIR, f), { force: true });
};
beforeEach(reset);
afterAll(reset);

const at = (s: string) => new Date(s).getTime();
const call = (id: string, when: string, n: number, extra: Partial<CallRow> = {}): CallRow => ({
  id,
  at: at(when),
  account: 'main',
  chat: 's1',
  model: 'claude-opus',
  input: n,
  output: n * 2,
  cacheWrite: n * 3,
  cacheRead: n * 4,
  ...extra,
});

describe('usage store', () => {
  it('saves windows and model buckets and returns the latest sample', () => {
    saveSample('main', { rate_limits: { five_hour: { utilization: 10, resets_at: null }, seven_day: { utilization: 5, resets_at: null } } }, 1000);
    saveSample(
      'main',
      {
        rate_limits: {
          five_hour: { utilization: 42.4, resets_at: '2026-11-26T12:00:00Z' },
          seven_day: { utilization: 17.6, resets_at: '2026-11-30T08:00:00Z' },
          seven_day_opus: { utilization: 3, resets_at: null },
          seven_day_sonnet: { utilization: null, resets_at: null },
          model_scoped: [{ display_name: 'Fable', utilization: 60, resets_at: '2026-11-29T00:00:00Z' }],
        },
      },
      2000,
    );
    expect(latestSample('main')).toEqual({
      at: 2000,
      fiveHour: { pct: 42, resetsAt: at('2026-11-26T12:00:00Z') },
      week: { pct: 18, resetsAt: at('2026-11-30T08:00:00Z') },
      models: expect.arrayContaining([
        { name: 'seven_day_opus', pct: 3, resetsAt: null },
        { name: 'Fable', pct: 60, resetsAt: at('2026-11-29T00:00:00Z') },
      ]),
    });
    expect(latestSample('main')!.models).toHaveLength(2);
    expect(latestSample('alt')).toBe(null);
    expect(samplesSince('main', 1500)).toEqual([{ at: 2000, fiveHour: 42.4, week: 17.6 }]);
  });

  it('saves extra usage for an account without 5h or weekly windows', () => {
    saveSample('alt2', { rate_limits: { extra_usage: { is_enabled: true, monthly_limit: 500, used_credits: 120.5, utilization: 24.1, currency: 'USD' } } }, 3000);
    expect(latestSample('alt2')).toEqual({ at: 3000, models: [], extra: { enabled: true, limit: 500, used: 120.5, pct: 24.1, currency: 'USD' } });
    expect(samplesSince('alt2', 0)).toEqual([{ at: 3000 }]);
  });

  // bun test runs in UTC while SQLite uses the system zone, so calls sit mid-day.
  it('stores each message id once and sums tokens per local day', () => {
    expect(saveCall(call('m1', '2026-11-25T10:00:00', 1))).toBe(true);
    expect(saveCall(call('m1', '2026-11-25T10:00:00', 1))).toBe(false);
    expect(saveCalls([call('m1', '2026-11-25T10:00:00', 1), call('m2', '2026-11-25T14:00:00', 10), call('m3', '2026-11-26T11:00:00', 100, { guessed: true })])).toBe(2);
    saveCall(call('m4', '2026-11-26T12:00:00', 1000, { account: 'alt' }));
    saveCall(call('m0', '2026-11-20T10:00:00', 7));
    expect(tokensByDay('main', at('2026-11-24T00:00:00'))).toEqual([
      { day: '2026-11-25', input: 11, output: 22, cacheWrite: 33, cacheRead: 44 },
      { day: '2026-11-26', input: 100, output: 200, cacheWrite: 300, cacheRead: 400 },
    ]);
    expect(tokensByDay('alt', 0)).toEqual([{ day: '2026-11-26', input: 1000, output: 2000, cacheWrite: 3000, cacheRead: 4000 }]);
  });

  it('keeps meta values', () => {
    expect(getMeta('backfilled_at')).toBe(null);
    setMeta('backfilled_at', '1');
    setMeta('backfilled_at', '2');
    expect(getMeta('backfilled_at')).toBe('2');
  });
});
