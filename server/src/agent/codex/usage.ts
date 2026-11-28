import type { PlanUsage, UsageWindow } from '../../../../shared/protocol.js';
import type { CallRow } from '../../usage/store.js';
import type { RateLimitWindow, RateLimits, TokenUsageBreakdown } from './protocol.js';

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

// When the plan has usage again: the reset of the most used window, or five hours on when no window says.
export function limitUntil(u: PlanUsage | null | undefined, now = Date.now()) {
  const windows = [u?.fiveHour, u?.week].filter((w): w is UsageWindow => Boolean(w?.resetsAt));
  const fullest = windows.sort((a, b) => b.pct - a.pct)[0];
  return fullest?.resetsAt ?? now + FIVE_HOURS * 60_000;
}

// A turn's tokens as one calls row; Codex counts cached input inside input, the table keeps it apart.
export function turnCall(turnId: string, chat: string | null, model: string | null, t: TokenUsageBreakdown, at = Date.now()): CallRow {
  return {
    id: `codex:${turnId}`,
    at,
    account: 'codex',
    provider: 'codex',
    chat,
    model,
    input: t.inputTokens - t.cachedInputTokens,
    output: t.outputTokens,
    cacheWrite: t.cacheWriteInputTokens ?? 0,
    cacheRead: t.cachedInputTokens,
    reasoning: t.reasoningOutputTokens,
  };
}

export function addUsage(sum: TokenUsageBreakdown | null, t: TokenUsageBreakdown): TokenUsageBreakdown {
  if (!sum) return { ...t };
  return {
    totalTokens: sum.totalTokens + t.totalTokens,
    inputTokens: sum.inputTokens + t.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + t.cachedInputTokens,
    cacheWriteInputTokens: (sum.cacheWriteInputTokens ?? 0) + (t.cacheWriteInputTokens ?? 0),
    outputTokens: sum.outputTokens + t.outputTokens,
    reasoningOutputTokens: sum.reasoningOutputTokens + t.reasoningOutputTokens,
  };
}
