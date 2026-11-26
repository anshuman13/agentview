import { ACCOUNT_NAME, type UsageReport } from '../../../shared/protocol.js';
import { loggedInAccounts } from '../agent/claude/accounts.js';
import { latestSample, localDays, samplesSince, tokensByDay } from './store.js';

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
