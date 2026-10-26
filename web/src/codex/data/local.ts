import { BaseStore, WIKI_TABLES, type AssistantStore, type Patch } from './store';
import { edited, errorText, newCapture, runSync, toRow, type Dirty } from './engine';
import { FIELDS, TABLE_FIELDS, mergeIncoming } from './sync';
import type { Change, ItemRow, Profile, PulledChange, Reply, SyncRow } from './sync';
import type { Table, Tables } from './wiki';

const PATCHABLE = ['title', 'text', 'status', 'at', 'deleted'] as const;

type Invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type SqlValue = string | number | null;

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: Invoke } };
    __TAURI_INTERNALS__?: { invoke?: Invoke };
    AgentViewShell?: { unlock(): void };
  }
  interface WindowEventMap {
    'assistant-key': CustomEvent<{ key?: string; error?: string } | null>;
  }
}

export const tauriInvoke = () => window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;

const HUB = 'http://macmini.netbird.cloud:7790';
const SYNC_EVERY = 60000;
// Edits to the removed sample meetings and pages were saved on the phone; cleared once.
const SAMPLE_GONE = Date.UTC(2026, 9, 26, 11);

const table = (name: string) => `
  CREATE TABLE IF NOT EXISTS ${name} (
    id TEXT NOT NULL,
    profile TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    field_times TEXT NOT NULL DEFAULT '{}',
    ${TABLE_FIELDS[name].join(',\n    ')},
    dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile, id)
  );`;

const SCHEMA = `${['items', ...WIKI_TABLES].map(table).join('\n')}
  CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
`;

const upsertSQL = (name: string) => {
  const cols = ['id', 'profile', 'version', 'updated_at', 'deleted', 'field_times', ...TABLE_FIELDS[name], 'dirty'];
  const sets = cols.slice(2).map((c) => `${c} = excluded.${c}`).join(', ');
  return { cols, sql: `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT (profile, id) DO UPDATE SET ${sets}` };
};

async function post(since: number, changes: Change[]): Promise<Reply> {
  const resp = await fetch(`${HUB}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since, changes }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Hub returned HTTP ${resp.status}`);
  return resp.json();
}

export class LocalStore extends BaseStore implements AssistantStore {
  readonly kind = 'local';
  private unlocking: Promise<void> | null = null;

  constructor(private invoke: Invoke) {
    super('locked');
    this.set({ message: 'Locked' });
    setInterval(this.syncNow, SYNC_EVERY);
    window.addEventListener('online', this.syncNow);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.syncNow());
  }

  private query = async <T = ItemRow>(sql: string, params: SqlValue[] = []) => (await this.invoke<T[] | null>('assistant_query', { sql, params })) || [];
  private exec = (sql: string, params: SqlValue[] = []) => this.invoke<number>('assistant_exec', { sql, params });

  private async getState(key: string) {
    return (await this.query<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]))[0]?.value ?? '';
  }

  private setState(key: string, value: string | number) {
    return this.exec('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [key, String(value)]);
  }

  private getKey(): Promise<string> {
    const shell = window.AgentViewShell;
    if (!shell) return this.invoke<string>('assistant_dev_key');
    return new Promise((resolve, reject) => {
      window.addEventListener('assistant-key', (e) => {
        if (e.detail?.key) resolve(e.detail.key);
        else reject(new Error(e.detail?.error || 'Unlock cancelled'));
      }, { once: true });
      shell.unlock();
    });
  }

  private async open() {
    this.set({ phase: 'unlocking', message: 'Unlocking' });
    try {
      await this.invoke('assistant_open', { key: await this.getKey() });
      await this.invoke('assistant_batch', { sql: SCHEMA });
      for (const t of ['items', ...WIKI_TABLES]) {
        const have = new Set((await this.query<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
        for (const c of TABLE_FIELDS[t]) if (!have.has(c)) await this.invoke('assistant_batch', { sql: `ALTER TABLE ${t} ADD COLUMN ${c}` });
      }
      if (!(await this.getState('sample_cleared'))) {
        await this.invoke('assistant_batch', { sql: WIKI_TABLES.map((t) => `DELETE FROM ${t} WHERE updated_at < ${SAMPLE_GONE};`).join('\n') });
        await this.setState('sample_cleared', 1);
      }
      this.set({ phase: 'ready', message: '' });
      await this.refresh();
      this.syncNow();
    } catch (err) {
      this.set({ phase: 'locked', message: errorText(err) });
    }
  }

  async unlock() {
    if (this.ready) return;
    this.unlocking ??= this.open().finally(() => (this.unlocking = null));
    return this.unlocking;
  }

  protected async refresh() {
    if (!this.ready) return;
    const items = await this.query(`SELECT * FROM items WHERE deleted = 0 AND status IN ('open', 'note')`);
    const all = <K extends Table>(t: K) => this.query<Tables[K]>(`SELECT * FROM ${t} WHERE deleted = 0`);
    const [pages, facts, meetings, actions] = await Promise.all([all('pages'), all('facts'), all('meetings'), all('actions')]);
    if (this.ready) this.set({ items, pages, facts, meetings, actions });
  }

  private async applyChange(change: PulledChange) {
    if (change.table !== 'items') return this.applyRow(change);
    for (let attempt = 0; attempt < 5; attempt++) {
      const local = (await this.query('SELECT * FROM items WHERE profile = ? AND id = ?', [change.profile, change.id]))[0];
      const m = toRow(mergeIncoming(local ?? null, change));
      const values = [m.version, m.updated_at, m.deleted, m.field_times, ...FIELDS.map((f) => m[f]), m.dirty];
      const changed = local
        ? await this.exec(
          `UPDATE items SET version = ?, updated_at = ?, deleted = ?, field_times = ?, ${FIELDS.map((f) => `${f} = ?`).join(', ')}, dirty = ?
           WHERE profile = ? AND id = ? AND updated_at = ? AND field_times = ?`,
          [...values, m.profile, m.id, local.updated_at, local.field_times],
        )
        : await this.exec(
          `INSERT OR IGNORE INTO items (version, updated_at, deleted, field_times, ${FIELDS.join(', ')}, dirty, profile, id)
           VALUES (${Array(values.length + 2).fill('?').join(', ')})`,
          [...values, m.profile, m.id],
        );
      if (changed) return;
    }
    throw new Error(`Could not merge item ${change.id}`);
  }

  private async applyRow(change: PulledChange) {
    const local = (await this.query<SyncRow>(`SELECT * FROM ${change.table} WHERE profile = ? AND id = ?`, [change.profile, change.id]))[0];
    await this.write(change.table, toRow(mergeIncoming<SyncRow>(local ?? null, change)));
  }

  private write(name: string, row: SyncRow) {
    const { cols, sql } = upsertSQL(name);
    const values = row as unknown as Record<string, SqlValue>;
    return this.exec(sql, cols.map((c) => values[c] ?? null));
  }

  // Wiki rows are pushed only once the hub has sent some, so a hub without the tables is never asked to store them.
  private async dirtyRows(): Promise<Dirty[]> {
    const wiki = (await this.query(WIKI_TABLES.map((t) => `SELECT 1 FROM ${t} WHERE version > 0`).join(' UNION ') + ' LIMIT 1')).length > 0;
    const tables = wiki ? ['items', ...WIKI_TABLES] : ['items'];
    const rows = await Promise.all(tables.map(async (t) => (await this.query<SyncRow>(`SELECT * FROM ${t} WHERE dirty = 1`)).map((row): Dirty => ({ table: t, row }))));
    return rows.flat();
  }

  editRow = async <K extends Table>(name: K, row: Tables[K], patch: Partial<Tables[K]>) => {
    if (!this.ready) return;
    const current = (await this.query<Tables[K]>(`SELECT * FROM ${name} WHERE profile = ? AND id = ?`, [row.profile, row.id]))[0] ?? row;
    await this.write(name, edited(current, patch, Date.now()));
    await this.refresh();
    this.syncNow();
  };

  protected syncOnce() {
    return runSync({
      active: () => this.ready,
      since: async () => Number(await this.getState('since')) || 0,
      saveSince: (since) => this.setState('since', since).then(() => {}),
      dirty: () => this.dirtyRows(),
      post,
      clean: ({ table: name, row }) => this.exec(
        `UPDATE ${name} SET dirty = 0 WHERE profile = ? AND id = ? AND updated_at = ? AND field_times = ?`,
        [row.profile, row.id, row.updated_at, row.field_times],
      ).then(() => {}),
      apply: (change) => this.applyChange(change),
    });
  }

  async capture(text: string, type: 'task' | 'note', profile: Profile, at: number | null = null) {
    const r = newCapture(text, type, profile, Date.now(), at);
    await this.exec(
      `INSERT INTO items (id, profile, version, updated_at, deleted, field_times, title, text, source, at, status, dirty)
       VALUES (?, ?, 0, ?, 0, ?, ?, ?, 'capture', ?, ?, 1)`,
      [r.id, r.profile, r.updated_at, r.field_times, r.title, r.text, r.at, r.status],
    );
    await this.refresh();
    this.syncNow();
    return r;
  }

  private async edit(row: ItemRow, sql: string, params: (now: number) => SqlValue[]) {
    try {
      const now = Date.now();
      await this.exec(
        `UPDATE items SET ${sql}, updated_at = max(updated_at, ?), dirty = 1 WHERE profile = ? AND id = ?`,
        [...params(now), now, row.profile, row.id],
      );
      await this.refresh();
      this.syncNow();
    } catch (err) {
      if (this.ready) console.error('Edit failed', err);
    }
  }

  update = (row: ItemRow, patch: Patch) => {
    const keys = PATCHABLE.filter((k) => k in patch);
    if (!keys.length) return Promise.resolve();
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const times = keys.map((k) => `'$.${k}', ?`).join(', ');
    return this.edit(row, `${sets}, field_times = json_set(field_times, ${times})`, (now) => [...keys.map((k) => patch[k] ?? null), ...keys.map(() => now)]);
  };

  fetchTranscript = async (m: { profile: Profile; id: string }) => {
    const resp = await fetch(`${HUB}/transcripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: m.profile, id: m.id }),
      signal: AbortSignal.timeout(300000),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(data?.error || `Hub returned HTTP ${resp.status}`);
    await this.syncNow();
    return Number(data?.saved ?? 0);
  };
}
