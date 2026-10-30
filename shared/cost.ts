import type { ChatEvent } from './protocol.js';

// A result carries the running total of its session, which starts over after /clear.
const costRise = (costUsd: number, last: number) => (costUsd >= last ? costUsd - last : costUsd);

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
