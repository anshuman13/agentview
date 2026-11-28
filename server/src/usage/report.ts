import { ACCOUNT_NAME, type Provider, type UsageReport } from '../../../shared/protocol.js';
import { burnRate, helperAdvice } from '../../../shared/build.js';
import { chatAccount, loggedInAccounts } from '../agent/claude/accounts.js';
import { providerOf } from '../agent/registry.js';
import { latestSample, localDays, samplesSince, tokensByDay, type UsageKey } from './store.js';

const WEEK = 7 * 24 * 3600_000;

export function usageReport(days = 30, now = Date.now()): UsageReport {
  const { list, since } = localDays(days, now);
  return {
    accounts: loggedInAccounts().map((account) => {
      const byDay = new Map(tokensByDay(account, since).map((d) => [d.day, d]));
      return {
        account,
        name: ACCOUNT_NAME[account],
        latest: latestSample(account),
        series: samplesSince(account, now - WEEK),
        days: list.map((day) => byDay.get(day) ?? { day, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }),
      };
    }),
  };
}

// The samples a chat's usage is measured by: its provider, and for Claude the account the chat is on.
export function usageKey(o: { chat?: string; provider?: Provider }): UsageKey | undefined {
  const p = o.chat ? providerOf(o.chat) : (o.provider ?? 'claude');
  if (p !== 'claude') return p;
  return (o.chat && chatAccount(o.chat)) || loggedInAccounts()[0];
}

// How many more subagents a chat running `agents` agents (itself included) may start now, from the last 15 minutes of burn.
export function helperReport(agents: number, key: UsageKey | undefined = loggedInAccounts()[0], now = Date.now()) {
  if (key === 'openrouter') return { helpers: 0, why: 'no helper agents on this provider' };
  const latest = key ? latestSample(key) : null;
  if (!key || !latest?.fiveHour) return { helpers: 0, why: 'no 5-hour usage known' };
  const rate = burnRate(samplesSince(key, now - 15 * 60_000));
  return helperAdvice({ pct: latest.fiveHour.pct, resetsAt: latest.fiveHour.resetsAt, rate, weekPct: latest.week?.pct ?? null, agents }, now);
}
