import type { Database } from 'bun:sqlite';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { Account } from '../../shared/protocol.js';
import { getMeta, setMeta } from './db.js';
import { DAY, ymd } from './time.js';
import { configDir, guardLimit, limitedUntil, stopOnOverage, verifyLimit } from '../../server/src/agent/claude/accounts.js';

// One run on the account, with no saved session or settings. It refuses at the usage limit and stops before extra usage.
const ASK_TIMEOUT_MS = 10 * 60_000;

// Every hub run adds its cost per model to a day row in meta, spend:YYYY-MM-DD, kept 30 days.
export type Spend = Record<string, { usd: number; tokens: number; runs: number }>;
const SPEND_DAYS = 30;
let ledger: Database | null = null;
export const trackSpend = (db: Database) => ((ledger = db), db);
const dayKey = (t: number) => `spend:${ymd(t)}`;
const jobKey = (t: number) => `jobspend:${ymd(t)}`;
type JobSpend = Record<string, { usd: number; runs: number }>;
type ModelUse = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number };

export function recordSpend(db: Database, models: Record<string, ModelUse>, now = Date.now(), jobId?: string) {
  const key = dayKey(now);
  const day: Spend = JSON.parse(getMeta(db, key) ?? '{}');
  for (const [model, u] of Object.entries(models)) {
    const row = (day[model] ??= { usd: 0, tokens: 0, runs: 0 });
    row.usd += u.costUSD;
    row.tokens += u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
    row.runs += 1;
  }
  setMeta(db, key, JSON.stringify(day));
  if (jobId) {
    const jobs: JobSpend = JSON.parse(getMeta(db, jobKey(now)) ?? '{}');
    const row = (jobs[jobId] ??= { usd: 0, runs: 0 });
    row.usd += Object.values(models).reduce((n, u) => n + u.costUSD, 0);
    row.runs += 1;
    setMeta(db, jobKey(now), JSON.stringify(jobs));
  }
  db.prepare("DELETE FROM meta WHERE key LIKE 'spend:%' AND key < ?").run(dayKey(now - SPEND_DAYS * DAY));
  db.prepare("DELETE FROM meta WHERE key LIKE 'jobspend:%' AND key < ?").run(jobKey(now - SPEND_DAYS * DAY));
}

// Today and the last 7 days, per model, most expensive first; the week also has USD per job id.
export function spendSummary(db: Database, now = Date.now()) {
  const sum = (days: number) => {
    const by: Spend = {};
    for (let i = 0; i < days; i++) {
      const day: Spend = JSON.parse(getMeta(db, dayKey(now - i * DAY)) ?? '{}');
      for (const [model, r] of Object.entries(day)) {
        const row = (by[model] ??= { usd: 0, tokens: 0, runs: 0 });
        row.usd += r.usd;
        row.tokens += r.tokens;
        row.runs += r.runs;
      }
    }
    const models = Object.entries(by).map(([model, r]) => ({ model, ...r })).sort((a, b) => b.usd - a.usd);
    return { usd: models.reduce((n, m) => n + m.usd, 0), models };
  };
  const jobs: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const day: JobSpend = JSON.parse(getMeta(db, jobKey(now - i * DAY)) ?? '{}');
    for (const [id, r] of Object.entries(day)) jobs[id] = (jobs[id] ?? 0) + r.usd;
  }
  return { today: sum(1), week: { ...sum(7), jobs } };
}

// The MCP servers a run on the account loads, read once from the init message of a run stopped before any model call.
const loaded = new Map<Account, Promise<string[]>>();
function serversOf(account: Account, env: Record<string, string | undefined>) {
  let p = loaded.get(account);
  if (!p) {
    p = (async () => {
      const abortController = new AbortController();
      try {
        for await (const m of query({ prompt: 'init', options: { persistSession: false, settingSources: [], maxTurns: 1, abortController, env } })) {
          if (m.type === 'system' && m.subtype === 'init') {
            abortController.abort();
            return [...new Set(m.tools.filter((t) => t.startsWith('mcp__')).map((t) => t.split('__')[1]))];
          }
        }
      } catch {}
      return [];
    })();
    p.then((s) => s.length || loaded.delete(account));
    loaded.set(account, p);
  }
  return p;
}

// A run that names its tools loads only the MCP servers those tools come from; each connector costs its tool
// definitions on every turn (Sentry alone is 73 tools). A run with canUseTool decides per call, so it keeps them all.
async function unusedServers(account: Account, options: Options, env: Record<string, string | undefined>) {
  if (!options.allowedTools || options.canUseTool) return [];
  const used = new Set([...options.allowedTools.map((t) => t.split('__')[1]), ...Object.keys(options.mcpServers ?? {})]);
  return (await serversOf(account, env)).filter((s) => !used.has(s)).map((s) => `mcp__${s}`);
}

export async function* ask(account: Account, prompt: string, options: Options, timeoutMs = ASK_TIMEOUT_MS, jobId?: string) {
  await verifyLimit(account);
  guardLimit(account);
  const dir = configDir(account);
  // Scans need the claude.ai connectors from the first turn, so the run waits for them to connect.
  const env = { ...process.env, MCP_CONNECTION_NONBLOCKING: '0', ...options.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) };
  const unused = await unusedServers(account, options, env);
  const abortController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  const q = query({ prompt, options: { persistSession: false, settingSources: [], ...options, disallowedTools: [...(options.disallowedTools ?? []), ...unused], abortController, env } });
  let ended = false;
  const note = (m: { type: string }) => {
    if (m.type !== 'result') return;
    ended = true;
    const usage = (m as { modelUsage?: Record<string, ModelUse> }).modelUsage;
    if (!ledger || !usage) return;
    try {
      recordSpend(ledger, usage, Date.now(), jobId);
    } catch (err) {
      console.log(`spend: not recorded, ${String(err)}`);
    }
  };
  try {
    // Read by hand, not with for await, so a caller that stops early does not close the run before its cost is known.
    for (;;) {
      const r = await q.next();
      if (r.done) break;
      stopOnOverage(account, r.value);
      note(r.value);
      yield r.value;
    }
    if (timedOut) throw new Error(`Claude run timed out after ${Math.round(timeoutMs / 60_000)} min`);
  } catch (err) {
    if (timedOut) throw new Error(`Claude run timed out after ${Math.round(timeoutMs / 60_000)} min`);
    throw err;
  } finally {
    clearTimeout(timer);
    // A run stopped once its work was saved gets interrupted, and the result it then sends carries the cost.
    if (!ended && !timedOut) await settle(q, note);
    await q.return(undefined).catch(() => {});
  }
}

async function settle(q: ReturnType<typeof query>, note: (m: { type: string }) => void) {
  const drain = async () => {
    await q.interrupt();
    for (;;) {
      const r = await q.next();
      if (r.done) return;
      note(r.value);
      if (r.value.type === 'result') return;
    }
  };
  await Promise.race([drain().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
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
