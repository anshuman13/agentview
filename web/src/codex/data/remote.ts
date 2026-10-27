import { BaseStore, WIKI_TABLES, type AssistantStore, type MeetingRef, type Parsed, type Patch } from './store';
import { edited, newCapture, runSync, toRow, type Dirty } from './engine';
import { mergeIncoming } from './sync';
import type { Change, ItemRow, Profile, PulledChange, Reply, SyncRow } from './sync';
import type { Table, Tables } from './wiki';

const SYNC_EVERY = 30000;

const call = (path: string, init?: RequestInit) => fetch(path, init);

async function hub(path: string, body?: unknown): Promise<Reply> {
  const resp = await call(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || `Server returned HTTP ${resp.status}`);
  return data;
}

const keyOf = (row: Pick<SyncRow, 'profile' | 'id'>) => `${row.profile}:${row.id}`;

type Cached = { since: number; tables: Record<string, SyncRow[]> };

// The browser keeps the rows and the hub version in IndexedDB, so a reload pulls only rows changed since.
function cacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('agentview-codex', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('cache');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheOp<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await cacheDb();
  return new Promise((resolve, reject) => {
    const req = op(db.transaction('cache', mode).objectStore('cache'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close()) as Promise<T>;
}

export class RemoteStore extends BaseStore implements AssistantStore {
  readonly kind = 'remote';
  private tables: Record<string, Map<string, SyncRow>> = Object.fromEntries(['items', ...WIKI_TABLES].map((t) => [t, new Map()]));
  private since = 0;
  private loaded = this.load();

  constructor() {
    super('ready');
    setInterval(() => document.visibilityState === 'visible' && this.syncNow(), SYNC_EVERY);
    window.addEventListener('online', this.syncNow);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.syncNow());
  }

  private get rows() {
    return this.tables.items as Map<string, ItemRow>;
  }

  private async load() {
    const cached = await cacheOp<Cached | undefined>('readonly', (s) => s.get('snapshot')).catch(() => undefined);
    if (!cached) return;
    for (const [table, rows] of Object.entries(cached.tables)) {
      const map = this.tables[table];
      if (map) for (const row of rows) if (!map.has(keyOf(row))) map.set(keyOf(row), row);
    }
    this.since = cached.since;
    await this.refresh();
  }

  private save() {
    const cached: Cached = { since: this.since, tables: Object.fromEntries(Object.entries(this.tables).map(([t, m]) => [t, [...m.values()]])) };
    cacheOp('readwrite', (s) => s.put(cached, 'snapshot')).catch(() => {});
  }

  async unlock() {
    await this.syncNow();
  }

  protected async refresh() {
    const all = <K extends Table>(t: K) => [...this.tables[t].values()] as Tables[K][];
    this.set({ items: [...this.rows.values()], pages: all('pages'), facts: all('facts'), meetings: all('meetings'), actions: all('actions'), jobs: all('jobs'), runs: all('runs') });
  }

  // Wiki rows are pushed only once the hub has sent some, so a hub without the tables is never asked to store them.
  private hubHasWiki() {
    return WIKI_TABLES.some((t) => [...this.tables[t].values()].some((r) => r.version > 0));
  }

  protected async syncOnce() {
    await this.loaded;
    const changed = await runSync({
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
        const now = map.get(keyOf(row));
        if (now && now.updated_at === row.updated_at && now.field_times === row.field_times) map.set(keyOf(row), { ...now, dirty: 0 });
      },
      apply: async (change: PulledChange) => {
        const map = this.tables[change.table];
        map.set(keyOf(change), toRow(mergeIncoming<SyncRow>(map.get(keyOf(change)) ?? null, change)));
      },
    });
    if (changed) this.save();
    return changed;
  }

  private put(table: string, row: SyncRow) {
    this.tables[table].set(keyOf(row), row);
    this.save();
    this.refresh();
    this.syncNow();
  }

  async capture(text: string, type: 'task' | 'note', profile: Profile, at: number | null = null, meeting: MeetingRef = null) {
    const row = newCapture(text, type, profile, Date.now(), at, meeting);
    this.put('items', row);
    return row;
  }

  async update(row: ItemRow, patch: Patch) {
    this.put('items', edited(this.rows.get(keyOf(row)) ?? row, patch, Date.now()));
  }

  editRow = async <K extends Table>(table: K, row: Tables[K], patch: Partial<Tables[K]>) => {
    const current = (this.tables[table].get(keyOf(row)) as Tables[K] | undefined) ?? row;
    this.put(table, edited(current, patch, Date.now()));
  };

  parse = async (text: string, profile: Profile): Promise<Parsed> => {
    const resp = await call('/api/assistant/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile, text }), signal: AbortSignal.timeout(20000) });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(data?.error || `Server returned HTTP ${resp.status}`);
    return data;
  };

  fetchTranscript = async (m: { profile: Profile; id: string }) => {
    const resp = await call('/api/assistant/transcripts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: m.profile, id: m.id }) });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(data?.error || `Server returned HTTP ${resp.status}`);
    await this.syncNow();
    return Number(data?.saved ?? 0);
  };

  syncCalendar = async (fresh = 0) => {
    const resp = await call(`/api/assistant/calendar${fresh ? `?fresh=${fresh}` : ''}`, { method: 'POST' });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(data?.error || `Server returned HTTP ${resp.status}`);
    await this.syncNow();
    return Number(data?.changed ?? 0);
  };
}
