import { BaseStore, WIKI_TABLES, transcriptOf, transcriptPath, type AssistantStore, type AutopilotConfig, type AutopilotState, type ReplyHistory, type SentReply, type MeetingRef, type Parsed, type Patch, type Snapshot, type TranscriptHit } from './store';
import { edited, errorText, moved, newCapture, runSync, toRow, type Dirty } from './tasks/engine';
import { TABLE_FIELDS, mergeIncoming } from './sync';
import { captureParams, doneCutoff, patchSQL, swapSQL, type SqlValue } from './localRows';
import type { Change, ItemRow, Profile, PulledChange, Reply, SyncRow } from './sync';
import type { Table, Tables } from './wiki/wiki';
import { apiUrl } from '../../app/api';
import { hub, LONG_TIMEOUT, QUICK_TIMEOUT, REPLY_TIMEOUT, SYNC_TIMEOUT } from './hubFetch';
import { showSnack, snackParked } from '../view';

type Invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

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

// The hub through the chosen Mac's AgentView, which forwards to wherever that Mac's hub runs.
export const hubUrl = () => apiUrl('/api/assistant');
const SYNC_EVERY = 60000;
// Edits to the removed sample meetings and pages were saved on the phone; cleared once, then everything is pulled again
// because the clear also removed hub rows.
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

const post = (since: number, changes: Change[], full?: boolean) => hub<Reply>(`${hubUrl()}/sync`, { since, changes, full }, SYNC_TIMEOUT);

export class LocalStore extends BaseStore implements AssistantStore {
  readonly kind = 'local';
  private unlocking: Promise<void> | null = null;
  private rejects = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;
  private onVisible = () => document.visibilityState === 'visible' && this.syncSoon();

  constructor(private invoke: Invoke) {
    super('locked');
    this.set({ message: 'Locked' });
    this.timer = setInterval(this.onVisible, SYNC_EVERY);
    window.addEventListener('online', this.syncSoon);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  dispose() {
    clearInterval(this.timer);
    window.removeEventListener('online', this.syncSoon);
    document.removeEventListener('visibilitychange', this.onVisible);
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
      // Rows of a table this app did not know yet were skipped by earlier pulls, as were columns below.
      const known = new Set((await this.query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((t) => t.name));
      await this.invoke('assistant_batch', { sql: SCHEMA });
      // Rows pulled before a column existed never get its value unless everything is pulled again.
      let added = LocalStore.ALL.some((t) => !known.has(t));
      for (const t of ['items', ...WIKI_TABLES]) {
        const have = new Set((await this.query<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
        if (!have.size) continue;
        for (const c of TABLE_FIELDS[t]) {
          if (have.has(c)) continue;
          await this.invoke('assistant_batch', { sql: `ALTER TABLE ${t} ADD COLUMN ${c}` });
          added = true;
        }
      }
      if (added || !(await this.getState('meeting_link_repulled'))) {
        await this.setState('since', 0);
        await this.setState('meeting_link_repulled', 1);
      }
      if (!(await this.getState('sample_cleared'))) {
        await this.invoke('assistant_batch', { sql: WIKI_TABLES.map((t) => `DELETE FROM ${t} WHERE updated_at < ${SAMPLE_GONE};`).join('\n') });
        await this.setState('sample_cleared', 1);
      }
      if (!(await this.getState('sample_repulled'))) {
        await this.setState('since', 0);
        await this.setState('sample_repulled', 1);
      }
      this.set({ phase: 'ready', message: '' });
      await this.refresh(LocalStore.ALL);
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

  private seqs: Record<string, number> = {};
  private syncTouched = new Set<string>();
  private static ALL = ['items', ...WIKI_TABLES];

  // Re-reads only the named tables (every table when none are given). A read that finishes after a later read of the
  // same table started is dropped, so older rows never replace newer ones. Rows with the same version and times keep
  // their object, and a table whose rows are all unchanged keeps its array.
  protected async refresh(given?: string[]) {
    if (!this.ready) return;
    const tables = given ?? (this.syncTouched.size ? [...this.syncTouched] : LocalStore.ALL);
    if (!given) this.syncTouched.clear();
    const seq = tables.map((t) => [t, (this.seqs[t] = (this.seqs[t] ?? 0) + 1)] as const);
    const read = (t: string) => t === 'items'
      ? this.query<SyncRow>(`SELECT * FROM items WHERE deleted = 0 AND (IFNULL(status, '') NOT IN ('done', 'raised') OR updated_at > ?)`, [doneCutoff(Date.now())])
      : this.query<SyncRow>(`SELECT * FROM ${t} WHERE deleted = 0`);
    const rows = await Promise.all(tables.map(read)).catch((e) => {
      if (!given) tables.forEach((t) => this.syncTouched.add(t));
      throw e;
    });
    if (!this.ready) return;
    const snap = this.snapshot() as unknown as Record<string, SyncRow[]>;
    const next: Record<string, SyncRow[]> = {};
    seq.forEach(([t, n], i) => {
      if (this.seqs[t] !== n) return;
      const prev = new Map(snap[t].map((r) => [`${r.profile}:${r.id}`, r]));
      const merged = rows[i].map((r) => {
        const old = prev.get(`${r.profile}:${r.id}`);
        return old && old.version === r.version && old.updated_at === r.updated_at && old.field_times === r.field_times ? old : r;
      });
      if (merged.length !== snap[t].length || merged.some((r, j) => r !== snap[t][j])) next[t] = merged;
    });
    if (Object.keys(next).length) this.set(next as Partial<Snapshot>);
  }

  // Merges or edits a row with compare-and-swap, retrying when another write lands between the read and the write.
  private async swap(name: string, profile: Profile, id: string, next: (local: SyncRow | undefined) => SyncRow) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const local = (await this.query<SyncRow>(`SELECT * FROM ${name} WHERE profile = ? AND id = ?`, [profile, id]))[0];
      const { sql, params } = swapSQL(name, next(local), local);
      if (await this.exec(sql, params)) return;
    }
    throw new Error(`Could not save ${name} row ${id}`);
  }

  private batchMissing = false;

  // Applies a pulled page in one transaction. A row changed by another write since it was read is retried on its own,
  // and an app build without the batch command applies rows one at a time.
  private async applyChanges(changes: PulledChange[]) {
    if (!changes.length) return;
    if (!this.batchMissing) {
      try {
        const locals = new Map<string, SyncRow>();
        for (const name of new Set(changes.map((c) => c.table))) {
          const ids = changes.filter((c) => c.table === name).map((c) => c.id);
          for (let i = 0; i < ids.length; i += 400) {
            const chunk = ids.slice(i, i + 400);
            const rows = await this.query<SyncRow>(`SELECT * FROM ${name} WHERE id IN (${chunk.map(() => '?').join(', ')})`, chunk);
            for (const r of rows) locals.set(`${name}:${r.profile}:${r.id}`, r);
          }
        }
        const statements = changes.map((c) => {
          const local = locals.get(`${c.table}:${c.profile}:${c.id}`);
          const { sql, params } = swapSQL(c.table, toRow(mergeIncoming<SyncRow>(local ?? null, c)), local);
          return [sql, params];
        });
        const counts = await this.invoke<number[]>('assistant_exec_many', { statements });
        for (const [i, c] of changes.entries()) {
          if (!counts[i] && locals.has(`${c.table}:${c.profile}:${c.id}`)) await this.applyChange(c);
          this.syncTouched.add(c.table);
        }
        return;
      } catch (err) {
        if (!/not found/i.test(errorText(err))) throw err;
        this.batchMissing = true;
      }
    }
    for (const c of changes) {
      await this.applyChange(c);
      this.syncTouched.add(c.table);
    }
  }

  private applyChange(change: PulledChange) {
    return this.swap(change.table, change.profile, change.id, (local) => toRow(mergeIncoming<SyncRow>(local ?? null, change)));
  }

  // Wiki rows are pushed only once the hub has sent some, so a hub without the tables is never asked to store them.
  private async dirtyRows(): Promise<Dirty[]> {
    const wiki = (await this.query(WIKI_TABLES.map((t) => `SELECT 1 FROM ${t} WHERE version > 0`).join(' UNION ') + ' LIMIT 1')).length > 0;
    const tables = wiki ? ['items', ...WIKI_TABLES] : ['items'];
    const rows = await Promise.all(tables.map(async (t) => (await this.query<SyncRow>(`SELECT * FROM ${t} WHERE dirty = 1`)).map((row): Dirty => ({ table: t, row }))));
    return rows.flat();
  }

  editRow = async <K extends Table>(name: K, row: Tables[K], patch: Partial<Tables[K]>) => {
    try {
      if (!this.ready) throw new Error('Locked');
      await this.swap(name, row.profile, row.id, (local) => edited((local as Tables[K] | undefined) ?? row, patch, Date.now()));
      await this.refresh([name]);
      this.syncNow();
    } catch (err) {
      showSnack(`Not saved: ${errorText(err)}`);
    }
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
      ).then(() => void this.syncTouched.add(name)),
      apply: (change) => this.applyChange(change).then(() => void this.syncTouched.add(change.table)),
      applyAll: (changes) => this.applyChanges(changes),
      paused: (paused) => this.setSync({ paused }),
      scans: (scans) => this.setSync({ scans }),
      rejects: this.rejects,
      parked: snackParked,
    });
  }

  async capture(text: string, type: 'task' | 'note' | 'goal', profile: Profile, at: number | null = null, meeting: MeetingRef = null) {
    const r = newCapture(text, type, profile, Date.now(), at, meeting);
    await this.exec(
      `INSERT INTO items (id, profile, version, updated_at, deleted, field_times, title, text, source, people, at, status, meeting_id, dirty)
       VALUES (?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      captureParams(r),
    );
    await this.refresh(['items']);
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
      await this.refresh(['items']);
      this.syncNow();
    } catch (err) {
      showSnack(`Not saved: ${errorText(err)}`);
    }
  }

  update = (row: ItemRow, patch: Patch) => {
    const p = patchSQL(patch);
    return p ? this.edit(row, p.sql, p.params) : Promise.resolve();
  };

  move = async (row: ItemRow, profile: Profile, goal: string | null = null) => {
    const now = Date.now();
    const current = this.snapshot().items.find((r) => r.profile === row.profile && r.id === row.id) ?? row;
    await this.swap('items', profile, row.id, (there) => moved(current, there as ItemRow | undefined, profile, now, goal));
    await this.update(row, { deleted: 1 });
  };

  parse = (text: string, profile: Profile) => hub<Parsed>(`${hubUrl()}/parse`, { profile, text }, QUICK_TIMEOUT);

  fetchTranscript = async (m: { profile: Profile; id: string }, instructions?: string) => {
    const data = await hub<{ saved?: number }>(`${hubUrl()}/transcripts`, { profile: m.profile, id: m.id, instructions }, LONG_TIMEOUT);
    await this.syncNow();
    return Number(data?.saved ?? 0);
  };

  syncCalendar = async (fresh = 0) => {
    const data = await hub<{ changed?: number }>(`${hubUrl()}/calendar${fresh ? `?fresh=${fresh}` : ''}`, undefined, LONG_TIMEOUT, 'POST');
    await (data?.changed ? this.syncNow() : this.syncSoon());
    return Number(data?.changed ?? 0);
  };

  blockTime = async (row: ItemRow, start: number, end: number, title: string) => {
    await this.syncNow();
    await hub(`${hubUrl()}/calendar/block`, { profile: row.profile, id: row.id, start, end, title }, REPLY_TIMEOUT);
    await this.syncNow();
  };

  summarizeSlack = async () => {
    const data = await hub<{ added?: number }>(`${hubUrl()}/slack/summary`, undefined, LONG_TIMEOUT, 'POST');
    await this.syncNow();
    return Number(data?.added ?? 0);
  };

  replyHistory = async (): Promise<ReplyHistory> => ({ replies: [] });

  sendReply = async (id: string, edited: boolean, text?: string) => {
    const r = await hub<SentReply>(`${hubUrl()}/slack/reply?id=${encodeURIComponent(id)}${edited ? '&edited=1' : ''}`, { text }, REPLY_TIMEOUT);
    await this.syncNow();
    return r;
  };

  skipAsk = async (id: string) => {
    await hub(`${hubUrl()}/slack/skip?id=${encodeURIComponent(id)}`, undefined, QUICK_TIMEOUT, 'POST');
    await this.syncNow();
  };

  autopilot = (patch?: Partial<AutopilotConfig>) => hub<AutopilotState>(`${hubUrl()}/autopilot`, patch, SYNC_TIMEOUT);

  scanNow = async (name: 'slack' | 'gmail') => {
    await hub(`${hubUrl()}/scan?name=${name}`, undefined, LONG_TIMEOUT, 'POST');
    await this.syncNow();
  };

  searchTranscripts = async (query: string, profile?: Profile) => {
    const data = await hub<{ hits?: TranscriptHit[] }>(`${hubUrl()}/transcripts/search?q=${encodeURIComponent(query)}${profile ? `&profile=${profile}` : ''}`, undefined, QUICK_TIMEOUT);
    return data?.hits ?? [];
  };

  transcript = async (m: { profile: Profile; id: string }) => transcriptOf(await fetch(`${hubUrl()}${transcriptPath(m)}`, { signal: AbortSignal.timeout(QUICK_TIMEOUT) }));
}
