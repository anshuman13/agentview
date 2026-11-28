import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { Account } from '../../../shared/protocol.js';
import { configDir, STATE_DIR } from '../agent/claude/accounts.js';
import { sampleAll, sampleCodex } from './sampler.js';
import { closeStore, latestSample, type RawUsage } from './store.js';

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

const max: RawUsage = {
  rate_limits: {
    five_hour: { utilization: 30, resets_at: '2026-11-26T12:00:00Z' },
    seven_day: { utilization: 55, resets_at: '2026-11-30T08:00:00Z' },
    model_scoped: [{ display_name: 'Fable', utilization: 70, resets_at: null }],
  },
};
const enterprise: RawUsage = {
  rate_limits: { extra_usage: { is_enabled: true, monthly_limit: 500, used_credits: 125, utilization: 25, currency: 'USD' } },
};

describe('usage sampler', () => {
  it('saves a Max-style and an Enterprise-style answer, skipping a failing read', async () => {
    const read = async (a: Account) => {
      if (a === 'alt') throw new Error('timed out');
      return a === 'main' ? max : enterprise;
    };
    await sampleAll(read);
    expect(latestSample('main')).toMatchObject({
      fiveHour: { pct: 30, resetsAt: new Date('2026-11-26T12:00:00Z').getTime() },
      week: { pct: 55, resetsAt: new Date('2026-11-30T08:00:00Z').getTime() },
      models: [{ name: 'Fable', pct: 70, resetsAt: null }],
    });
    expect(latestSample('main')!.extra).toBeUndefined();
    expect(latestSample('alt')).toBe(null);
    const ent = latestSample('alt2')!;
    expect(ent.fiveHour).toBeUndefined();
    expect(ent.week).toBeUndefined();
    expect(ent.extra).toEqual({ enabled: true, limit: 500, used: 125, pct: 25, currency: 'USD' });
  });

  it('does not sample accounts that are not logged in', async () => {
    rmSync(path.join(logins[1], '.claude.json'));
    const asked: Account[] = [];
    await sampleAll(async (a) => {
      asked.push(a);
      return max;
    });
    expect(asked).toEqual(['main', 'alt']);
    expect(latestSample('alt2')).toBe(null);
    writeFileSync(path.join(logins[1], '.claude.json'), JSON.stringify({ oauthAccount: {} }));
  });

  it('saves Codex rate limits under codex, and nothing when signed out', async () => {
    const reply = { rateLimits: { primary: { usedPercent: 12.4, windowDurationMins: 300, resetsAt: 1794260000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null } } };
    await sampleCodex(async () => reply.rateLimits);
    expect(latestSample('codex')).toMatchObject({ fiveHour: { pct: 12, resetsAt: 1794260000_000 }, week: { pct: 40, resetsAt: null }, models: [] });
    reset();
    await sampleCodex(async () => null);
    expect(latestSample('codex')).toBe(null);
  });
});
