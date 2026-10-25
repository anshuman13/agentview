import { BaseStore, type AssistantStore } from './store';
import { errorText, newCapture, nextNine, runSync, toRow } from './engine';
import { FIELDS, mergeIncoming } from './sync';
import type { Change, ItemRow, Profile, PulledChange, Reply } from './sync';

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
const LOCK_AFTER = 60000;
const SYNC_EVERY = 60000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS items (
    id TEXT NOT NULL,
    profile TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    field_times TEXT NOT NULL DEFAULT '{}',
    ${FIELDS.join(',\n    ')},
    dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile, id)
  );
  CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
`;

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
  private closing: Promise<void> = Promise.resolve();
  private hiddenAt = 0;
  private lockTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private invoke: Invoke) {
    super('locked');
    this.set({ message: 'Locked' });
    setInterval(this.syncNow, SYNC_EVERY);
    window.addEventListener('online', this.syncNow);
    document.addEventListener('visibilitychange', () => {
      clearTimeout(this.lockTimer);
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now();
        this.lockTimer = setTimeout(() => this.lock(), LOCK_AFTER);
        return;
      }
      if (this.hiddenAt && Date.now() - this.hiddenAt >= LOCK_AFTER) this.lock();
      this.syncNow();
    });
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
      await this.closing;
      await this.invoke('assistant_open', { key: await this.getKey() });
      await this.invoke('assistant_batch', { sql: SCHEMA });
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

  private lock() {
    clearTimeout(this.lockTimer);
    if (!this.ready) return;
    this.set({ phase: 'locked', message: 'Locked', items: [], sync: { syncing: false, last: 0, error: '' } });
    this.closing = this.invoke<void>('assistant_close').catch((err) => console.error('assistant_close failed', err));
  }

  protected async refresh() {
    if (!this.ready) return;
    const items = await this.query(`SELECT * FROM items WHERE deleted = 0 AND status IN ('open', 'note')`);
    if (this.ready) this.set({ items });
  }

  private async applyChange(change: PulledChange) {
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

  protected syncOnce() {
    return runSync({
      active: () => this.ready,
      since: async () => Number(await this.getState('since')) || 0,
      saveSince: (since) => this.setState('since', since).then(() => {}),
      dirty: () => this.query('SELECT * FROM items WHERE dirty = 1'),
      post,
      clean: (row) => this.exec(
        'UPDATE items SET dirty = 0 WHERE profile = ? AND id = ? AND updated_at = ? AND field_times = ?',
        [row.profile, row.id, row.updated_at, row.field_times],
      ).then(() => {}),
      apply: (change) => this.applyChange(change),
    });
  }

  async capture(text: string, type: 'task' | 'note', profile: Profile) {
    const r = newCapture(text, type, profile, Date.now());
    await this.exec(
      `INSERT INTO items (id, profile, version, updated_at, deleted, field_times, title, text, source, status, dirty)
       VALUES (?, ?, 0, ?, 0, ?, ?, ?, 'capture', ?, 1)`,
      [r.id, r.profile, r.updated_at, r.field_times, r.title, r.text, r.status],
    );
    await this.refresh();
    this.syncNow();
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

  done = (row: ItemRow) => this.edit(row, `status = 'done', field_times = json_set(field_times, '$.status', ?)`, (now) => [now]);
  snooze = (row: ItemRow) => this.edit(row, `at = ?, field_times = json_set(field_times, '$.at', ?)`, (now) => [nextNine(), now]);
  remove = (row: ItemRow) => this.edit(row, `deleted = 1, field_times = json_set(field_times, '$.deleted', ?)`, (now) => [now]);
}
