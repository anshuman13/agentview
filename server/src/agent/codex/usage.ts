import type { PlanUsage, UsageWindow } from '../../../../shared/protocol.js';
import type { RateLimitWindow, RateLimits } from './protocol.js';

const FIVE_HOURS = 300;
const WEEK = 10_080;

// Reset times come as unix seconds.
const windowOf = (w: RateLimitWindow | null | undefined): UsageWindow | null => (w ? { pct: Math.round(w.usedPercent), resetsAt: w.resetsAt ? w.resetsAt * 1000 : null } : null);

// The 5-hour and weekly windows, told apart by length since a plan may report only one of them or list them in either slot.
export function planUsage(r: RateLimits): PlanUsage {
  const all = [r.primary, r.secondary].filter((w): w is RateLimitWindow => Boolean(w));
  const length = (w: RateLimitWindow) => w.windowDurationMins ?? 0;
  return { fiveHour: windowOf(all.find((w) => length(w) > 0 && length(w) <= FIVE_HOURS)), week: windowOf(all.find((w) => length(w) >= WEEK)) };
}
