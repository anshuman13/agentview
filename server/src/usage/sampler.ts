import type { Account } from '../../../shared/protocol.js';
import { errText } from '../../../shared/util.js';
import { liveUsage, loggedInAccounts } from '../agent/claude/accounts.js';
import { saveSample, type RawUsage } from './store.js';

const EVERY_MS = 5 * 60_000;

// One sample per logged-in account, read one at a time; a failed read is logged and skipped.
export async function sampleAll(read: (a: Account) => Promise<RawUsage> = (a) => liveUsage(a) as Promise<RawUsage>) {
  for (const a of loggedInAccounts()) {
    try {
      saveSample(a, await read(a));
    } catch (err) {
      console.error(`usage sample ${a}:`, errText(err));
    }
  }
}

export function startSampler() {
  const run = () => void sampleAll();
  run();
  setInterval(run, EVERY_MS).unref();
}
