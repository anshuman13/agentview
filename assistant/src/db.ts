import { Database, type Statement } from 'bun:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { TABLES } from '../../shared/tables.js';

export const DB_DIR = path.join(os.homedir(), '.agentview', 'assistant');
const DB_PATH = path.join(DB_DIR, 'assistant.db');

export type Profile = 'work' | 'personal';
export const isProfile = (v: unknown): v is Profile => v === 'work' || v === 'personal';

export { TABLES };

// The non-blank strings of a JSON array column; anything else reads as empty.
export function textList(s: string | null): string[] {
  try {
    const v = JSON.parse(s ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  } catch {
    return [];
  }
}

const COMMON_COLUMNS = `
  id TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (profile IN ('work','personal')),
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  field_times TEXT NOT NULL DEFAULT '{}'
`;

function createTableSQL(tableName: string, dataColumns: string[]): string {
  const columns = [COMMON_COLUMNS];
  for (const col of dataColumns) {
    columns.push(`${col}`);
  }
  columns.push(`PRIMARY KEY (profile, id)`);
  return `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(',')})`;
}

function createIndexSQL(tableName: string): string {
  return `CREATE INDEX IF NOT EXISTS ${tableName}_version_idx ON ${tableName}(version)`;
}

export function openDb(file: string = DB_PATH): Database {
  if (file !== ':memory:') {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(file);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = OFF');
  db.run('PRAGMA busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  // Transcript text stays on the hub: it is large and the apps search it here. folded is the lowercased text.
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcripts (
      profile TEXT NOT NULL,
      id TEXT NOT NULL,
      doc TEXT,
      text TEXT NOT NULL,
      folded TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile, id)
    )
  `);

  // Decisions the Slack scan saw in channels, kept on the hub for wiki updates.
  db.exec(`
    CREATE TABLE IF NOT EXISTS slack_decisions (
      profile TEXT NOT NULL,
      id TEXT NOT NULL,
      text TEXT NOT NULL,
      channel TEXT NOT NULL,
      url TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (profile, id)
    )
  `);

  for (const [tableName, dataColumns] of Object.entries(TABLES)) {
    db.exec(createTableSQL(tableName, dataColumns));
    db.exec(createIndexSQL(tableName));
    const existing = new Set((db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map((c) => c.name));
    for (const col of dataColumns) {
      if (!existing.has(col)) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col}`);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS items_meeting_idx ON items(profile, meeting_id)');
  db.exec('CREATE INDEX IF NOT EXISTS items_status_idx ON items(profile, status)');
  db.exec('CREATE INDEX IF NOT EXISTS meetings_starts_idx ON meetings(starts_at)');
  db.exec('CREATE INDEX IF NOT EXISTS facts_replaces_idx ON facts(profile, replaces)');
  db.exec('CREATE INDEX IF NOT EXISTS runs_job_idx ON runs(profile, job_id)');

  const versionRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('version');
  if (!versionRow) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('version', '0');
  }

  return db;
}

const statements = new WeakMap<Database, Map<string, Statement>>();

export function stmt(db: Database, sql: string): Statement {
  let cache = statements.get(db);
  if (!cache) statements.set(db, (cache = new Map()));
  let st = cache.get(sql);
  if (!st) cache.set(sql, (st = db.prepare(sql)));
  return st;
}

export function nextVersion(db: Database): number {
  const result = stmt(db, 'UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = ? RETURNING CAST(value AS INTEGER) AS value')
    .get('version') as { value: number } | undefined;

  if (result) {
    return result.value;
  }

  throw new Error('Failed to update version');
}

export const getMeta = (db: Database, key: string) => (stmt(db, 'SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | null)?.value ?? null;
export const setMeta = (db: Database, key: string, value: string) => stmt(db, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
export const deleteMeta = (db: Database, key: string) => stmt(db, 'DELETE FROM meta WHERE key = ?').run(key);

// Drops the meta keys under prefix whose value, a time in ms, is older than before.
export function pruneMeta(db: Database, prefix: string, before: number) {
  stmt(db, "DELETE FROM meta WHERE substr(key, 1, length(?)) = ? AND CAST(value AS INTEGER) < ?").run(prefix, prefix, before);
}

export function currentVersion(db: Database): number {
  const row = db.prepare('SELECT CAST(value AS INTEGER) as value FROM meta WHERE key = ?').get('version') as { value: number } | undefined;
  return row ? row.value : 0;
}
