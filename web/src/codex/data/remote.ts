import { BaseStore, WIKI_TABLES, transcriptOf, transcriptPath, type AssistantStore, type MeetingRef, type Parsed, type Patch, type Snapshot, type TranscriptHit } from './store';
import { edited, moved, newCapture, runSync, toRow, type Dirty } from './engine';
import { TABLE_FIELDS, mergeIncoming, rowKey } from './sync';
import type { Change, ItemRow, Profile, PulledChange, Reply, SyncRow } from './sync';
import type { Table, Tables } from './wiki';

const SYNC_EVERY = 30000;
const SAVE_DELAY = 500;
const HUB_TIMEOUT = 30000;

const call = (path: string, init?: RequestInit) => fetch(path, init);

async function hub<T = Reply>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const post = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(HUB_TIMEOUT)]) : AbortSignal.timeout(HUB_TIMEOUT);
  const resp = await call(path, { ...post, ...init, signal });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || `Server returned HTTP ${resp.status}`);
  return data;
}


type Cached = { since: number; tables: Record<string, SyncRow[]> };

const META_KEY = 'meta';
const LEGACY_KEY = 'snapshot';
const tableKey = (table: string) => `table:${table}`;
// Rows cached before a column existed never get its value unless everything is pulled again.
const COLUMNS = JSON.stringify(TABLE_FIELDS);

// The browser keeps the rows and the hub version in IndexedDB, so a reload pulls only rows changed since.
let dbOpen: Promise<IDBDatabase> | undefined;

function cacheDb(): Promise<IDBDatabase> {
  return (dbOpen ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('agentview-codex', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('cache');
    req.onsuccess = () => {
      req.result.onclose = req.result.onversionchange = () => (dbOpen = undefined);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbOpen = undefined;
    throw e;
  }));
}

async function cacheOp<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await cacheDb();
  return new Promise((resolve, reject) => {
    // Settles on the commit, so a quota error at commit time is not reported as saved.
    const tx = db.transaction('cache', mode);
    const req = op(tx.objectStore('cache'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
  });
}

export class RemoteStore extends BaseStore implements AssistantStore {
  readonly kind = 'remote';
  private tables: Record<string, Map<string, SyncRow>> = Object.fromEntries(['items', ...WIKI_TABLES].map((t) => [t, new Map()]));
  private since = 0;
  private loaded = this.load();
  private saving: Promise<void> = Promise.resolve();
  private unsaved = new Set<string>();
  private writes = 0;
  private saveDue = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTouched = new Set<string>();
  private timer: ReturnType<typeof setInterval>;
  private onVisible = () => document.visibilityState === 'visible' && this.syncNow();
  private onHide = () => document.visibilityState === 'hidden' && this.flush();
  private onPageHide = () => this.flush();

  constructor() {
    super('ready');
    this.timer = setInterval(this.onVisible, SYNC_EVERY);
    window.addEventListener('online', this.syncNow);
    document.addEventListener('visibilitychange', this.onVisible);
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onPageHide);
  }

  dispose() {
    clearInterval(this.timer);
    window.removeEventListener('online', this.syncNow);
    document.removeEventListener('visibilitychange', this.onVisible);
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('pagehide', this.onPageHide);
    this.flush();
  }

  private get rows() {
    return this.tables.items as Map<string, ItemRow>;
  }

  private async load() {
    const read = <T>(key: string) => cacheOp<T | undefined>('readonly', (s) => s.get(key)).catch(() => undefined);
    const meta = await read<{ since: number; columns?: string }>(META_KEY);
    let cached: Cached | undefined;
    if (meta) {
      cached = { since: meta.columns === COLUMNS ? meta.since : 0, tables: {} };
      // A table missing from the cache would never be fetched again, so start over with a full sync, keeping the rows held.
      for (const table of Object.keys(this.tables)) {
        const rows = await read<SyncRow[]>(tableKey(table));
        if (rows) cached.tables[table] = rows;
        else cached.since = 0;
      }
    } else {
      cached = await read<Cached>(LEGACY_KEY);
    }
    if (!cached) return;
    for (const [table, rows] of Object.entries(cached.tables)) {
      const map = this.tables[table];
      if (map) for (const row of rows) if (!map.has(rowKey(row))) map.set(rowKey(row), row);
    }
    this.since = cached.since;
    if (!meta) {
      this.save(Object.keys(this.tables));
      this.flush();
      this.saving = this.saving.then(() => cacheOp('readwrite', (s) => s.delete(LEGACY_KEY)).then(() => {}, () => {}));
    }
    await this.refresh(Object.keys(this.tables));
  }

  // Saves are coalesced: tables touched within SAVE_DELAY are written once, from the rows as they are at flush time.
  private save(tables: string[]) {
    tables.forEach((t) => this.unsaved.add(t));
    this.saveDue = true;
    this.saveTimer ??= setTimeout(() => this.flush(), SAVE_DELAY);
  }

  private flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.saveDue) return;
    this.saveDue = false;
    const run = async () => {
      // Every row pulled up to this version is in a queued table, so the version is read before the tables are.
      const since = this.since;
      const names = [...this.unsaved];
      this.unsaved.clear();
      const write = (key: string, value: unknown) => cacheOp('readwrite', (s) => s.put(value, key));
      // A table that failed stays queued and the version is not saved, so a reload never skips its rows.
      try {
        for (const [i, table] of names.entries()) {
          try {
            await write(tableKey(table), [...this.tables[table].values()]);
          } catch (e) {
            names.slice(i).forEach((t) => this.unsaved.add(t));
            throw e;
          }
        }
        await write(META_KEY, { since, columns: COLUMNS });
        this.setSync({ saveError: false });
      } catch {
        this.setSync({ saveError: true });
      }
    };
    const done = () => void this.writes--;
    const next = this.writes++ ? this.saving.then(run) : run();
    this.saving = next.then(done, done);
  }

  async unlock() {
    await this.syncNow();
  }

  private countPending() {
    const pending = Object.values(this.tables).reduce((n, map) => n + [...map.values()].filter((r) => r.dirty).length, 0);
    if (pending !== this.snapshot().sync.pending) this.setSync({ pending });
  }

  protected async refresh(tables?: string[]) {
    this.countPending();
    const names = tables ?? [...this.syncTouched];
    this.syncTouched.clear();
    if (names.length) this.set(Object.fromEntries(names.map((t) => [t, [...this.tables[t].values()]])) as Partial<Snapshot>);
  }

  // Wiki rows are pushed only once the hub has sent some, so a hub without the tables is never asked to store them.
  private hubHasWiki() {
    return WIKI_TABLES.some((t) => [...this.tables[t].values()].some((r) => r.version > 0));
  }

  protected async syncOnce() {
    await this.loaded;
    return this.track(runSync({
      active: () => true,
      since: async () => this.since,
      saveSince: async (since) => void (this.since = since),
      dirty: async () => {
        const tables = this.hubHasWiki() ? Object.keys(this.tables) : ['items'];
        return tables.flatMap((table) => [...this.tables[table].values()].filter((r) => r.dirty).map((row): Dirty => ({ table, row })));
      },
      post: (since, changes: Change[]) => (changes.length ? hub('/api/assistant/sync', { since, changes }) : hub(`/api/assistant/changes?since=${since}`)),
      clean: async ({ table, row }) => {
        const map = this.tables[table];
        const now = map.get(rowKey(row));
        if (now && now.updated_at === row.updated_at && now.field_times === row.field_times) {
          map.set(rowKey(row), { ...now, dirty: 0 });
          this.syncTouched.add(table);
          this.save([table]);
        }
      },
      apply: async (change: PulledChange) => {
        const map = this.tables[change.table];
        map.set(rowKey(change), toRow(mergeIncoming<SyncRow>(map.get(rowKey(change)) ?? null, change)));
        this.syncTouched.add(change.table);
        this.save([change.table]);
      },
      paused: (paused) => this.setSync({ paused }),
      scans: (scans) => this.setSync({ scans }),
    }));
  }

  private track<T>(run: Promise<T>) {
    return run.finally(() => this.countPending());
  }

  private put(table: string, row: SyncRow) {
    this.tables[table].set(rowKey(row), row);
    this.save([table]);
    this.refresh([table]);
    this.syncNow();
  }

  async capture(text: string, type: 'task' | 'note' | 'goal', profile: Profile, at: number | null = null, meeting: MeetingRef = null) {
    const row = newCapture(text, type, profile, Date.now(), at, meeting);
    this.put('items', row);
    return row;
  }

  async update(row: ItemRow, patch: Patch) {
    this.put('items', edited(this.rows.get(rowKey(row)) ?? row, patch, Date.now()));
  }

  async move(row: ItemRow, profile: Profile) {
    const now = Date.now();
    const key = rowKey({ profile, id: row.id });
    const current = this.rows.get(rowKey(row)) ?? row;
    this.rows.set(key, moved(current, this.rows.get(key), profile, now));
    this.put('items', edited(current, { deleted: 1 }, now));
  }

  editRow = async <K extends Table>(table: K, row: Tables[K], patch: Partial<Tables[K]>) => {
    const current = (this.tables[table].get(rowKey(row)) as Tables[K] | undefined) ?? row;
    this.put(table, edited(current, patch, Date.now()));
  };

  parse = async (text: string, profile: Profile): Promise<Parsed> => hub<Parsed>('/api/assistant/parse', { profile, text }, { signal: AbortSignal.timeout(20000) });

  fetchTranscript = async (m: { profile: Profile; id: string }, instructions?: string) => {
    const data = await hub<{ saved?: number }>('/api/assistant/transcripts', { profile: m.profile, id: m.id, instructions });
    await this.syncNow();
    return Number(data?.saved ?? 0);
  };

  syncCalendar = async (fresh = 0) => {
    const data = await hub<{ changed?: number }>(`/api/assistant/calendar${fresh ? `?fresh=${fresh}` : ''}`, undefined, { method: 'POST' });
    await this.syncNow();
    return Number(data?.changed ?? 0);
  };

  blockTime = async (row: ItemRow, start: number, end: number, title: string) => {
    await this.syncNow();
    await hub('/api/assistant/calendar/block', { profile: row.profile, id: row.id, start, end, title }, { signal: AbortSignal.timeout(120000) });
    await this.syncNow();
  };

  summarizeSlack = async () => {
    const data = await hub<{ added?: number }>('/api/assistant/slack/summary', undefined, { method: 'POST' });
    await this.syncNow();
    return Number(data?.added ?? 0);
  };

  scanNow = async (name: 'slack' | 'gmail') => {
    await hub(`/api/assistant/scan?name=${name}`, undefined, { method: 'POST', signal: AbortSignal.timeout(300000) });
    await this.syncNow();
  };

  searchTranscripts = async (query: string, profile?: Profile) => (await hub<{ hits?: TranscriptHit[] }>(`/api/assistant/transcripts/search?q=${encodeURIComponent(query)}${profile ? `&profile=${profile}` : ''}`)).hits ?? [];

  transcript = async (m: { profile: Profile; id: string }) => transcriptOf(await call(`/api/assistant${transcriptPath(m)}`));
}
