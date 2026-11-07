import { chatCost, costByModel } from '../../../shared/cost.js';
import type { ChatEvent } from '../../../shared/protocol.js';

type Costs = { cost: number; spend: ReturnType<typeof costByModel> };
export const costScans = { chatCost, costByModel };

// result events are append-only, so the events array identity + length is a safe key.
const costCache = new WeakMap<ChatEvent[], { length: number; dayStart: number; costs: Costs }>();
export function costsOf(events: ChatEvent[], dayStart: number): Costs {
  const hit = costCache.get(events);
  if (hit && hit.length === events.length && hit.dayStart === dayStart) return hit.costs;
  const costs = { cost: costScans.chatCost(events), spend: costScans.costByModel(events, dayStart, Date.now()) };
  costCache.set(events, { length: events.length, dayStart, costs });
  return costs;
}
