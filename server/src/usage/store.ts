import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Account, Provider, UsageDay, UsageExtra, UsageLatest, UsageWindow } from '../../../shared/protocol.js';
import { STATE_DIR } from '../agent/claude/accounts.js';

type RateWindow = { utilization: number | null; resets_at: string | null } | null | undefined;
export type RawUsage = {
  rate_limits?: {
    five_hour?: RateWindow;
    seven_day?: RateWindow;
    seven_day_opus?: RateWindow;
    seven_day_sonnet?: RateWindow;
    seven_day_oauth_apps?: RateWindow;
    model_scoped?: ({ display_name: string } & NonNullable<RateWindow>)[];
    extra_usage?: { is_enabled: boolean; monthly_limit: number | null; used_credits: number | null; utilization: number | null; currency?: string | null } | null;
  } | null;
};

export type UsageKey = Account | 'codex';

export type CallRow = {
  id: string;
  at: number;
  account: UsageKey;
  provider?: Provider;
  chat: string | null;
  model: string | null;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning?: number;
  guessed?: boolean;
};

const KINDS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_oauth_apps'] as const;

let db: Database | null = null;

function store() {
  if (db) return db;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  db = new Database(path.join(STATE_DIR, 'usage.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY, account TEXT, at INTEGER, raw TEXT);
    CREATE INDEX IF NOT EXISTS samples_account_at ON samples(account, at);
    CREATE TABLE IF NOT EXISTS windows(sample INTEGER, kind TEXT, label TEXT, pct REAL, resets_at INTEGER);
    CREATE INDEX IF NOT EXISTS windows_sample ON windows(sample);
    CREATE TABLE IF NOT EXISTS extra(sample INTEGER, enabled INTEGER, monthly_limit REAL, used REAL, pct REAL, currency TEXT);
    CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, at INTEGER, account TEXT, chat TEXT, model TEXT, input INTEGER, output INTEGER, cache_write INTEGER, cache_read INTEGER, guessed INTEGER);
    CREATE INDEX IF NOT EXISTS calls_account_at ON calls(account, at);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
  `);
  migrateCalls(db);
  return db;
}

export function migrateCalls(d: Database) {
  const cols = new Set((d.query('PRAGMA table_info(calls)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('provider')) d.exec(`ALTER TABLE calls ADD COLUMN provider TEXT DEFAULT 'claude'`);
  if (!cols.has('reasoning')) d.exec('ALTER TABLE calls ADD COLUMN reasoning INTEGER DEFAULT 0');
}

export function closeStore() {
  db?.close();
  db = null;
}

const resetMs = (s: string | null) => (s ? Date.parse(s) : null);

export function saveSample(account: Account, raw: RawUsage, at = Date.now()) {
  const d = store();
  d.transaction(() => {
    const id = Number(d.query('INSERT INTO samples(account, at, raw) VALUES (?, ?, ?)').run(account, at, JSON.stringify(raw)).lastInsertRowid);
    const r = raw.rate_limits;
    if (!r) return;
    const win = d.query('INSERT INTO windows(sample, kind, label, pct, resets_at) VALUES (?, ?, ?, ?, ?)');
    for (const kind of KINDS) {
      const w = r[kind];
      if (w && w.utilization != null) win.run(id, kind, null, w.utilization, resetMs(w.resets_at));
    }
    for (const w of r.model_scoped ?? []) if (w.utilization != null) win.run(id, 'model', w.display_name, w.utilization, resetMs(w.resets_at));
    const e = r.extra_usage;
    if (e)
      d.query('INSERT INTO extra(sample, enabled, monthly_limit, used, pct, currency) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        e.is_enabled ? 1 : 0,
        e.monthly_limit,
        e.used_credits,
        e.utilization,
        e.currency ?? null,
      );
  })();
}

type WindowRow = { sample: number; kind: string; label: string | null; pct: number; resets_at: number | null };
const window = (w: WindowRow): UsageWindow => ({ pct: Math.round(w.pct), resetsAt: w.resets_at });

export function latestSample(account: Account): UsageLatest | null {
  const d = store();
  const s = d.query('SELECT id, at FROM samples WHERE account = ? ORDER BY at DESC, id DESC LIMIT 1').get(account) as { id: number; at: number } | null;
  if (!s) return null;
  const rows = d.query('SELECT * FROM windows WHERE sample = ?').all(s.id) as WindowRow[];
  const e = d.query('SELECT * FROM extra WHERE sample = ?').get(s.id) as { enabled: number; monthly_limit: number | null; used: number | null; pct: number | null; currency: string | null } | null;
  const five = rows.find((w) => w.kind === 'five_hour');
  const week = rows.find((w) => w.kind === 'seven_day');
  const extra: UsageExtra | undefined = e ? { enabled: !!e.enabled, limit: e.monthly_limit, used: e.used, pct: e.pct, currency: e.currency } : undefined;
  return {
    at: s.at,
    ...(five && { fiveHour: window(five) }),
    ...(week && { week: window(week) }),
    models: rows.filter((w) => w.kind !== 'five_hour' && w.kind !== 'seven_day').map((w) => ({ name: w.label ?? w.kind, ...window(w) })),
    ...(extra && { extra }),
  };
}

export function samplesSince(account: Account, since: number) {
  const rows = store()
    .query(
      `SELECT s.at, f.pct AS five, w.pct AS week FROM samples s
       LEFT JOIN windows f ON f.sample = s.id AND f.kind = 'five_hour'
       LEFT JOIN windows w ON w.sample = s.id AND w.kind = 'seven_day'
       WHERE s.account = ? AND s.at >= ? ORDER BY s.at`,
    )
    .all(account, since) as { at: number; five: number | null; week: number | null }[];
  return rows.map((r) => ({ at: r.at, ...(r.five != null && { fiveHour: r.five }), ...(r.week != null && { week: r.week }) }));
}

// Returns true when the row is new; a message id already stored is skipped.
export function saveCall(c: CallRow) {
  const r = store()
    .query(
      'INSERT OR IGNORE INTO calls(id, at, account, provider, chat, model, input, output, cache_write, cache_read, reasoning, guessed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(c.id, c.at, c.account, c.provider ?? 'claude', c.chat, c.model, c.input, c.output, c.cacheWrite, c.cacheRead, c.reasoning ?? 0, c.guessed ? 1 : 0);
  return r.changes > 0;
}

export function saveCalls(rows: CallRow[]) {
  let added = 0;
  store().transaction(() => {
    for (const c of rows) if (saveCall(c)) added++;
  })();
  return added;
}

export function callsSince(account: UsageKey, since: number): CallRow[] {
  const rows = store()
    .query(
      `SELECT id, at, account, provider, chat, model, input, output, cache_write AS cacheWrite, cache_read AS cacheRead, reasoning, guessed
       FROM calls WHERE account = ? AND at >= ? ORDER BY at, id`,
    )
    .all(account, since) as (Omit<CallRow, 'guessed'> & { guessed: number })[];
  return rows.map((r) => ({ ...r, guessed: !!r.guessed }));
}

// Token totals per local day, only for days with calls.
export function tokensByDay(account: UsageKey, since: number): UsageDay[] {
  return store()
    .query(
      `SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch', 'localtime') AS day,
              SUM(input) AS input, SUM(output) AS output, SUM(cache_write) AS cacheWrite, SUM(cache_read) AS cacheRead
       FROM calls WHERE account = ? AND at >= ? GROUP BY day ORDER BY day`,
    )
    .all(account, since) as UsageDay[];
}

export function getMeta(key: string) {
  return (store().query('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | null)?.value ?? null;
}

export function setMeta(key: string, value: string) {
  store().query('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, value);
}

// The last `days` local days ending today (oldest first) and the start of the first, in SQLite's local zone like tokensByDay.
export function localDays(days: number, now = Date.now()) {
  const d = store();
  const dayOf = d.query(`SELECT strftime('%Y-%m-%d', ? / 1000, 'unixepoch', 'localtime', ?) AS day`);
  const list = Array.from({ length: days }, (_, i) => (dayOf.get(now, `-${days - 1 - i} days`) as { day: string }).day);
  const start = d
    .query(`SELECT CAST(strftime('%s', ? / 1000, 'unixepoch', 'localtime', 'start of day', ?, 'utc') AS INTEGER) * 1000 AS ms`)
    .get(now, `-${days - 1} days`) as { ms: number };
  return { list, since: start.ms };
}
