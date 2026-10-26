import { Database } from 'bun:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

export const DB_DIR = path.join(os.homedir(), '.agentview', 'assistant');
export const DB_PATH = path.join(DB_DIR, 'assistant.db');

export const TABLES: Record<string, string[]> = {
  items: ['title', 'text', 'source', 'source_url', 'people', 'at', 'status'],
  facts: ['text', 'item_id', 'superseded_by', 'page_id', 'heading', 'sources', 'at', 'contested', 'state', 'replaces', 'added_by'],
  pages: ['title', 'section', 'summary', 'sort', 'state'],
  meetings: ['title', 'starts_at', 'ends_at', 'people', 'calendar_url', 'recorded_ms', 'notes', 'summary', 'decisions'],
  actions: ['meeting_id', 'kind', 'target', 'title', 'body', 'fields', 'status', 'result_url'],
  people: ['name', 'slack_id', 'emails', 'calendar_names'],
  links: ['from_type', 'from_id', 'to_type', 'to_id', 'kind'],
  embeddings: ['owner_type', 'owner_id', 'model', 'vector'],
  jobs: ['name', 'schedule', 'prompt', 'enabled', 'next_run_at'],
  runs: ['job_id', 'started_at', 'finished_at', 'status', 'output'],
};

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

  for (const [tableName, dataColumns] of Object.entries(TABLES)) {
    db.exec(createTableSQL(tableName, dataColumns));
    db.exec(createIndexSQL(tableName));
    const existing = new Set((db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map((c) => c.name));
    for (const col of dataColumns) {
      if (!existing.has(col)) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col}`);
    }
  }

  const versionRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('version');
  if (!versionRow) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('version', '0');
  }

  return db;
}

export function nextVersion(db: Database): number {
  const result = db
    .prepare('UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = ? RETURNING CAST(value AS INTEGER) AS value')
    .get('version') as { value: number } | undefined;

  if (result) {
    return result.value;
  }

  throw new Error('Failed to update version');
}

export function currentVersion(db: Database): number {
  const row = db.prepare('SELECT CAST(value AS INTEGER) as value FROM meta WHERE key = ?').get('version') as { value: number } | undefined;
  return row ? row.value : 0;
}
