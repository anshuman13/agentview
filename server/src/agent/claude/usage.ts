import type { UsageWindow } from '../../../../shared/protocol.js';

type RateWindow = { utilization: number | null; resets_at: string | null };

export const usageWindow = (w?: RateWindow | null): UsageWindow | null =>
  w && w.utilization !== null ? { pct: Math.round(w.utilization), resetsAt: w.resets_at ? Date.parse(w.resets_at) : null } : null;

export const sessionUsage = (u: { rate_limits_available: boolean; rate_limits?: { five_hour?: RateWindow | null; seven_day?: RateWindow | null } | null }) => {
  const r = u.rate_limits_available ? u.rate_limits : null;
  return r ? { fiveHour: usageWindow(r.five_hour), week: usageWindow(r.seven_day) } : null;
};
