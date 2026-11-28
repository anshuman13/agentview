import type { ChatEvent, Provider } from './protocol.js';
import { dollars, type TurnTokens } from './prices.js';
import { billing, type Billing } from './providers.js';

export const money = (n: number, billing: Billing = 'usd') =>
  billing === 'plan' ? 'Plan' : billing === 'none' ? '-' : n > 0 && n < 0.005 ? '<$0.01' : n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;

// A run's cost as the run card shows it: its summed tokens priced, or the provider's billing word.
export const runCost = (r: { tokens?: TurnTokens; provider?: Provider }) => money(dollars(r.tokens), billing(r.provider));

// Dollars of one turn's result, from its tokens and the price table.
export const resultCost = (e: ChatEvent) => (e.kind === 'result' ? dollars(e.tokens) : 0);

export function chatCost(events: ChatEvent[]) {
  let total = 0;
  for (const e of events) total += resultCost(e);
  return total;
}

export function costByModel(events: ChatEvent[], todayStart: number, now: number) {
  const weekStart = now - 7 * 24 * 3600 * 1000;
  const today: Record<string, number> = {};
  const week: Record<string, number> = {};
  for (const e of events) {
    const cost = resultCost(e);
    if (e.kind !== 'result' || cost <= 0) continue;
    const model = e.model ?? e.tokens?.model ?? 'Unknown';
    if (e.at >= weekStart) week[model] = (week[model] ?? 0) + cost;
    if (e.at >= todayStart) today[model] = (today[model] ?? 0) + cost;
  }
  return { today, week };
}
