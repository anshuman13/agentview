import type { Database } from 'bun:sqlite';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { Account } from '../../shared/protocol.js';
import { setMeta } from './db.js';
import { configDir, guardLimit, limitedUntil, stopOnOverage, verifyLimit } from '../../server/src/agent/claude/accounts.js';

// One run on the account, with no saved session or settings. It refuses at the usage limit and stops before extra usage.
export const ASK_TIMEOUT_MS = 10 * 60_000;

export async function* ask(account: Account, prompt: string, options: Options, timeoutMs = ASK_TIMEOUT_MS) {
  await verifyLimit(account);
  guardLimit(account);
  const dir = configDir(account);
  const env = { ...process.env, ...options.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) };
  const abortController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  try {
    for await (const m of query({ prompt, options: { persistSession: false, settingSources: [], ...options, abortController, env } })) {
      stopOnOverage(account, m);
      yield m;
    }
  } catch (err) {
    if (timedOut) throw new Error(`Claude run timed out after ${Math.round(timeoutMs / 60_000)} min`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type Paused = { scan: string; reason: string; until: number };

const noted = new Map<string, number>();

// A scan skipped at the usage limit logs and records the pause once per limit mark, so the apps can show it.
export async function scanPaused(db: Database, account: Account, scan: string, now = Date.now()) {
  if (limitedUntil(account) <= now || !(await verifyLimit(account))) return false;
  const until = limitedUntil(account);
  const key = `paused:${scan}:${account}`;
  if (noted.get(key) !== until) {
    noted.set(key, until);
    console.log(`${scan}: paused, the ${account} Claude account is at its usage limit until ${new Date(until).toLocaleString()}`);
    const value: Paused = { scan, reason: 'Claude usage limit', until };
    setMeta(db, key, JSON.stringify(value));
  }
  return true;
}

export function pausedScans(db: Database, now = Date.now()): Paused[] {
  const rows = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'paused:%' ORDER BY key DESC").all() as { key: string; value: string }[];
  return rows.filter((r) => limitedUntil(r.key.split(':')[2] as Account) > now).map((r) => JSON.parse(r.value) as Paused).filter((p) => p.until > now);
}
