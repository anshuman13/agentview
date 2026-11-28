import type { Account, UsageWindow } from '../../../shared/protocol.js';
import { errText } from '../../../shared/util.js';
import { liveUsage, loggedInAccounts } from '../agent/claude/accounts.js';
import { codexSignedIn } from '../agent/codex/binary.js';
import type { RateLimits } from '../agent/codex/protocol.js';
import { codexAdmin } from '../agent/codex/rpc.js';
import { planUsage } from '../agent/codex/usage.js';
import { backfillOnce } from './backfill.js';
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

async function readCodexLimits(): Promise<RateLimits | null> {
  if (!(await codexSignedIn())) return null;
  const rpc = await codexAdmin();
  return (await rpc.request<{ rateLimits: RateLimits }>('account/rateLimits/read')).rateLimits;
}

const rateWindow = (w: UsageWindow | null) => (w ? { utilization: w.pct, resets_at: w.resetsAt ? new Date(w.resetsAt).toISOString() : null } : null);

// Codex plan limits go in the same samples under the key 'codex'; nothing is saved when Codex is signed out.
export async function sampleCodex(read: () => Promise<RateLimits | null> = readCodexLimits) {
  try {
    const limits = await read();
    if (!limits) return;
    const u = planUsage(limits);
    saveSample('codex', { rate_limits: { five_hour: rateWindow(u.fiveHour), seven_day: rateWindow(u.week) } });
  } catch (err) {
    console.error('usage sample codex:', errText(err));
  }
}

export function startSampler() {
  backfillOnce();
  const run = () => void sampleAll().then(() => sampleCodex());
  run();
  setInterval(run, EVERY_MS).unref();
}
