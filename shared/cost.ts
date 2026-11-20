import type { ChatEvent } from './protocol.js';
import type { Billing } from './providers.js';

export const money = (n: number, billing: Billing = 'usd') =>
  billing === 'plan' ? 'Plan' : billing === 'none' ? '-' : n > 0 && n < 0.005 ? '<$0.01' : n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;

// A result carries the running total of its session, which starts over after /clear.
export const costRise = (costUsd: number, last: number) => (costUsd >= last ? costUsd - last : costUsd);

export function chatCost(events: ChatEvent[]) {
  let last = 0;
  let total = 0;
  for (const e of events) {
    if (e.kind !== 'result' || e.costUsd <= 0) continue;
    total += costRise(e.costUsd, last);
    last = e.costUsd;
  }
  return total;
}

export function costByModel(events: ChatEvent[], todayStart: number, now: number) {
  const weekStart = now - 7 * 24 * 3600 * 1000;
  const today: Record<string, number> = {};
  const week: Record<string, number> = {};
  let last = 0;
  for (const e of events) {
    if (e.kind !== 'result' || e.costUsd <= 0) continue;
    const rise = costRise(e.costUsd, last);
    last = e.costUsd;
    if (rise <= 0) continue;
    const model = e.model ?? 'Unknown';
    if (e.at >= weekStart) week[model] = (week[model] ?? 0) + rise;
    if (e.at >= todayStart) today[model] = (today[model] ?? 0) + rise;
  }
  return { today, week };
}
