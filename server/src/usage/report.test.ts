import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ACCOUNT_NAME, type Account, type UsageReport } from '../../../shared/protocol.js';
import { configDir, STATE_DIR } from '../agent/claude/accounts.js';
import { usageReport } from './report.js';
import { closeStore, saveCall, saveSample, type RawUsage } from './store.js';

const reset = () => {
  closeStore();
  for (const f of ['usage.db', 'usage.db-wal', 'usage.db-shm']) rmSync(path.join(STATE_DIR, f), { force: true });
};
const logins = (['alt', 'alt2'] as const).map((a) => configDir(a)!);
beforeAll(() => {
  for (const dir of logins) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'test@example.com' } }));
  }
});
beforeEach(reset);
afterAll(() => {
  reset();
  for (const dir of logins) rmSync(dir, { recursive: true, force: true });
});

const H = 3600_000;
const DAY = 24 * H;
const now = Date.parse('2026-11-26T12:00:00Z');
const max = (five: number, week: number): RawUsage => ({
  rate_limits: {
    five_hour: { utilization: five, resets_at: '2026-11-26T15:00:00Z' },
    seven_day: { utilization: week, resets_at: '2026-11-30T08:00:00Z' },
  },
});
let n = 0;
const call = (account: Account, at: number, input: number) =>
  saveCall({ id: `msg_${n++}`, at, account, chat: 's1', model: 'claude-opus-5-5', input, output: 10, cacheWrite: 100, cacheRead: 1000 });

describe('usage report', () => {
  it('returns one entry per account with latest values, the 7-day series and day totals', () => {
    saveSample('main', max(5, 40), now - 8 * DAY);
    saveSample('main', max(20, 50), now - H);
    saveSample('main', max(30, 55), now);
    saveSample('alt', max(10, 15), now);
    saveSample('alt2', {
      rate_limits: { extra_usage: { is_enabled: true, monthly_limit: 500, used_credits: 125, utilization: 25, currency: 'USD' } },
    }, now);
    call('main', now, 1);
    call('main', now - H, 2);
    call('main', now - 2 * DAY, 4);
    call('main', now - 40 * DAY, 8);
    call('alt2', now, 16);

    const { accounts } = usageReport(30, now);
    expect(accounts.map((a) => [a.account, a.name])).toEqual([
      ['main', 'Personal'],
      ['alt', 'Work'],
      ['alt2', 'Enterprise'],
    ]);
    for (const a of accounts) expect(Object.keys(a).sort()).toEqual(['account', 'days', 'latest', 'name', 'series']);

    const [main, alt, ent] = accounts;
    expect(main.latest).toMatchObject({
      at: now,
      fiveHour: { pct: 30, resetsAt: Date.parse('2026-11-26T15:00:00Z') },
      week: { pct: 55, resetsAt: Date.parse('2026-11-30T08:00:00Z') },
    });
    expect(main.series).toEqual([
      { at: now - H, fiveHour: 20, week: 50 },
      { at: now, fiveHour: 30, week: 55 },
    ]);
    expect(main.days).toHaveLength(30);
    expect(main.days.at(-1)).toEqual({ day: '2026-11-26', input: 3, output: 20, cacheWrite: 200, cacheRead: 2000 });
    expect(main.days.at(-3)).toEqual({ day: '2026-11-24', input: 4, output: 10, cacheWrite: 100, cacheRead: 1000 });
    expect(main.days.at(-2)).toEqual({ day: '2026-11-25', input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(main.days.reduce((s, d) => s + d.input, 0)).toBe(7);

    expect(alt.latest!.week!.pct).toBe(15);
    expect(alt.days.every((d) => d.input + d.output + d.cacheWrite + d.cacheRead === 0)).toBe(true);

    expect(ent.latest!.fiveHour).toBeUndefined();
    expect(ent.latest!.extra).toEqual({ enabled: true, limit: 500, used: 125, pct: 25, currency: 'USD' });
    expect(ent.series).toEqual([{ at: now }]);
    expect(ent.days.at(-1)!.input).toBe(16);
  });

  it('returns null latest and an empty series for an account without samples', () => {
    const { accounts } = usageReport(7, now);
    expect(accounts).toHaveLength(3);
    expect(accounts[0].latest).toBe(null);
    expect(accounts[0].series).toEqual([]);
    expect(accounts[0].days).toHaveLength(7);
  });

  it('matches the shape of the shared fixture', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../shared/fixtures/usage.json', import.meta.url), 'utf8')) as { report: UsageReport };
    saveSample('main', max(30, 55), now);
    call('main', now, 1);
    const real = usageReport(3, now).accounts[0];
    const keys = (o: object) => Object.keys(o).sort();
    for (const a of fixture.report.accounts) {
      expect(keys(a)).toEqual(keys(real));
      expect(a.name).toBe(ACCOUNT_NAME[a.account]);
      for (const d of a.days) expect(keys(d)).toEqual(keys(real.days[0]));
    }
    expect(keys(fixture.report.accounts[0].latest!)).toEqual(keys(real.latest!));
  });
});
