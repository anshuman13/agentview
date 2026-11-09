import { BaseStore, WIKI_TABLES, transcriptOf, transcriptPath, type AssistantStore, type AutopilotConfig, type AutopilotState, type ReplyHistory, type SentReply, type MeetingRef, type Parsed, type Patch, type Snapshot, type TranscriptHit } from './store';
import { edited, moved, newCapture, runSync, toRow, type Dirty } from './tasks/engine';
import { doneCutoff } from './localRows';
import { mergeIncoming, rowKey } from './sync';
import { COLUMNS, LEGACY_KEY, META_KEY, cacheOp, cacheWrite, rowId, rowRange, tableKey, type Cached } from './cache';
import type { Change, ItemRow, Profile, PulledChange, Reply, SyncRow } from './sync';
import type { Table, Tables } from './wiki/wiki';
import { hub, LONG_TIMEOUT, QUICK_TIMEOUT, REPLY_TIMEOUT, SYNC_TIMEOUT } from './hubFetch';

const SYNC_EVERY = 30000;
const SAVE_DELAY = 500;
const SYNC_DELAY = 400;

export class RemoteStore extends BaseStore implements AssistantStore {
  readonly kind = 'remote';
  private tables: Record<string, Map<string, SyncRow>> = Object.fromEntries(['items', ...WIKI_TABLES].map((t) => [t, new Map()]));
  private since = 0;
  private rejects = new Map<string, number>();
  private loaded = this.load();
  private saving: Promise<void> = Promise.resolve();
  private unsaved = new Map<string, Set<string>>();
  private stale: string[] = [];
  private writes = 0;
  private saveDue = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private dirtyKeys = new Set<string>();
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTouched = new Set<string>();
  private timer: ReturnType<typeof setInterval>;
  private onVisible = () => document.visibilityState === 'visible' && this.syncSoon();
  private onHide = () => document.visibilityState === 'hidden' && this.hide();
  private onPageHide = () => this.hide();

  constructor() {
    super('ready');
    this.timer = setInterval(this.onVisible, SYNC_EVERY);
    window.addEventListener('online', this.syncSoon);
    document.addEventListener('visibilitychange', this.onVisible);
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onPageHide);
  }

  dispose() {
    clearInterval(this.timer);
    window.removeEventListener('online', this.syncSoon);
    document.removeEventListener('visibilitychange', this.onVisible);
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('pagehide', this.onPageHide);
    clearTimeout(this.syncTimer);
    this.syncTimer = undefined;
    this.flush();
  }

  private hide() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
      this.syncNow();
    }
    this.flush();
  }

  private get rows() {
    return this.tables.items as Map<string, ItemRow>;
  }

  private async load() {
    const read = <T>(key: string) => cacheOp<T | undefined>('readonly', (s) => s.get(key)).catch(() => undefined);
    const meta = await read<{ since: number; columns?: string; layout?: number }>(META_KEY);
    let cached: Cached | undefined;
    if (meta?.layout === 2) {
      cached = { since: meta.columns === COLUMNS ? meta.since : 0, tables: {} };
      const names = Object.keys(this.tables);
      const all = await Promise.all(names.map((table) => cacheOp<SyncRow[]>('readonly', (s) => s.getAll(rowRange(table))).catch(() => undefined)));
      for (const [i, table] of names.entries()) {
        const rows = all[i];
        if (rows) cached.tables[table] = rows;
        else cached.since = 0;
      }
    } else if (meta) {
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
      if (map) for (const row of rows) if (!map.has(rowKey(row))) this.setRow(table, row);
    }
    this.since = cached.since;
    if (meta?.layout !== 2) {
      // The whole-table records are split into rows and deleted in the same write.
      for (const [table, map] of Object.entries(this.tables)) this.save(table, ...map.keys());
      this.stale = [LEGACY_KEY, ...Object.keys(this.tables).map(tableKey)];
      this.flush();
    }
    await this.refresh(Object.keys(this.tables));
  }

  // Saves are coalesced: rows touched within SAVE_DELAY are written once, as they are at flush time.
  private save(table: string, ...keys: string[]) {
    const set = this.unsaved.get(table) ?? new Set<string>();
    keys.forEach((k) => set.add(k));
    this.unsaved.set(table, set);
    this.saveDue = true;
    this.saveTimer ??= setTimeout(() => this.flush(), SAVE_DELAY);
  }

  private setRow(table: string, row: SyncRow) {
    this.tables[table].set(rowKey(row), row);
    this.dirtyKeys[row.dirty ? 'add' : 'delete'](`${table}:${rowKey(row)}`);
  }

  private flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.saveDue) return;
    this.saveDue = false;
    const run = async () => {
      // Every row pulled up to this version is queued, so the version is read before the rows are.
      const since = this.since;
      const pending = [...this.unsaved];
      this.unsaved.clear();
      const stale = this.stale;
      // Rows, deletions and the version commit together; on failure the rows stay queued and a reload never skips them.
      try {
        await cacheWrite((s) => {
          for (const [table, keys] of pending) {
            for (const key of keys) {
              const row = this.tables[table].get(key);
              if (row) s.put(row, rowId(table, key));
              else s.delete(rowId(table, key));
            }
          }
          stale.forEach((k) => s.delete(k));
          s.put({ since, columns: COLUMNS, layout: 2 }, META_KEY);
        });
        this.stale = this.stale.filter((k) => !stale.includes(k));
        this.setSync({ saveError: false });
      } catch {
        // Re-queued without a timer, so a lasting error retries on the next change, not in a loop.
        for (const [table, keys] of pending) {
          const set = this.unsaved.get(table) ?? new Set<string>();
          keys.forEach((k) => set.add(k));
          this.unsaved.set(table, set);
        }
        this.saveDue = true;
        this.setSync({ saveError: true });
      }
    };
    const done = () => void this.writes--;
    const next = this.writes++ ? this.saving.then(run) : run();
    this.saving = next.then(done, done);
  }

  async unlock() {
    await this.syncSoon();
  }

  private countPending() {
    const pending = this.dirtyKeys.size;
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
      post: (since, changes: Change[], full) => (changes.length ? hub<Reply>('/api/assistant/sync', { since, changes, full }, SYNC_TIMEOUT) : hub<Reply>(`/api/assistant/changes?since=${since}${full ? '&full=1' : ''}`, undefined, SYNC_TIMEOUT)),
      clean: async ({ table, row }) => {
        const map = this.tables[table];
        const now = map.get(rowKey(row));
        if (now && now.updated_at === row.updated_at && now.field_times === row.field_times) {
          this.setRow(table, { ...now, dirty: 0 });
          this.syncTouched.add(table);
          this.save(table, rowKey(row));
        }
      },
      apply: async (change: PulledChange) => {
        this.applySynced(change);
        this.prune(change.table);
      },
      applyAll: async (changes: PulledChange[]) => {
        for (const change of changes) this.applySynced(change);
        for (const table of new Set(changes.map((c) => c.table))) this.prune(table);
      },
      paused: (paused) => this.setSync({ paused }),
      scans: (scans) => this.setSync({ scans }),
      rejects: this.rejects,
      parked: (rows) => void import('../view').then((v) => v.snackParked(rows)),
    }));
  }

  private applySynced(change: PulledChange) {
    const map = this.tables[change.table];
    this.setRow(change.table, toRow(mergeIncoming<SyncRow>(map.get(rowKey(change)) ?? null, change)));
    this.save(change.table, rowKey(change));
    this.syncTouched.add(change.table);
  }

  private track<T>(run: Promise<T>) {
    return run.finally(() => this.countPending());
  }

  // Synced tombstones and old done items are not kept; LocalStore filters the same done rows when it reads.
  private prune(table: string) {
    const map = this.tables[table];
    const cutoff = doneCutoff(Date.now());
    for (const [key, row] of map) {
      const r = row as SyncRow & { status?: string | null };
      if (r.dirty) continue;
      if ((r.deleted && r.version > 0) || (table === 'items' && (r.status === 'done' || r.status === 'raised') && r.updated_at <= cutoff)) {
        map.delete(key);
        this.save(table, key);
      }
    }
  }

  private put(table: string, row: SyncRow) {
    this.setRow(table, row);
    this.save(table, rowKey(row));
    this.refresh([table]);
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      this.syncNow();
    }, SYNC_DELAY);
  }

  async capture(text: string, type: 'task' | 'note' | 'goal', profile: Profile, at: number | null = null, meeting: MeetingRef = null) {
    const row = newCapture(text, type, profile, Date.now(), at, meeting);
    this.put('items', row);
    return row;
  }

  async update(row: ItemRow, patch: Patch) {
    this.put('items', edited(this.rows.get(rowKey(row)) ?? row, patch, Date.now()));
  }

  async move(row: ItemRow, profile: Profile, goal: string | null = null) {
    const now = Date.now();
    const key = rowKey({ profile, id: row.id });
    const current = this.rows.get(rowKey(row)) ?? row;
    this.setRow('items', moved(current, this.rows.get(key), profile, now, goal));
    this.save('items', key);
    this.put('items', edited(current, { deleted: 1 }, now));
  }

  editRow = async <K extends Table>(table: K, row: Tables[K], patch: Partial<Tables[K]>) => {
    const current = (this.tables[table].get(rowKey(row)) as Tables[K] | undefined) ?? row;
    this.put(table, edited(current, patch, Date.now()));
  };

  parse = async (text: string, profile: Profile): Promise<Parsed> => hub<Parsed>('/api/assistant/parse', { profile, text }, QUICK_TIMEOUT);

  fetchTranscript = async (m: { profile: Profile; id: string }, instructions?: string) => {
    const data = await hub<{ saved?: number }>('/api/assistant/transcripts', { profile: m.profile, id: m.id, instructions }, LONG_TIMEOUT);
    await this.syncNow();
    return Number(data?.saved ?? 0);
  };

  syncCalendar = async (fresh = 0) => {
    const data = await hub<{ changed?: number }>(`/api/assistant/calendar${fresh ? `?fresh=${fresh}` : ''}`, undefined, LONG_TIMEOUT, 'POST');
    await (data?.changed ? this.syncNow() : this.syncSoon());
    return Number(data?.changed ?? 0);
  };

  blockTime = async (row: ItemRow, start: number, end: number, title: string) => {
    await this.syncNow();
    await hub('/api/assistant/calendar/block', { profile: row.profile, id: row.id, start, end, title }, REPLY_TIMEOUT);
    await this.syncNow();
  };

  summarizeSlack = async () => {
    const data = await hub<{ added?: number }>('/api/assistant/slack/summary', undefined, LONG_TIMEOUT, 'POST');
    await this.syncNow();
    return Number(data?.added ?? 0);
  };

  scanNow = async (name: 'slack' | 'gmail') => {
    await hub(`/api/assistant/scan?name=${name}`, undefined, LONG_TIMEOUT, 'POST');
    await this.syncNow();
  };

  replyHistory = (who: string) => hub<ReplyHistory>(`/api/assistant/history?who=${encodeURIComponent(who)}`, undefined, SYNC_TIMEOUT);

  sendReply = async (id: string, edited: boolean, text?: string) => {
    const r = await hub<SentReply>(`/api/assistant/slack/reply?id=${encodeURIComponent(id)}${edited ? '&edited=1' : ''}`, { text }, REPLY_TIMEOUT);
    await this.syncNow();
    return r;
  };

  skipAsk = async (id: string) => {
    await hub(`/api/assistant/slack/skip?id=${encodeURIComponent(id)}`, undefined, SYNC_TIMEOUT, 'POST');
    await this.syncNow();
  };

  autopilot = (patch?: Partial<AutopilotConfig>) => hub<AutopilotState>('/api/assistant/autopilot', patch, SYNC_TIMEOUT);

  searchTranscripts = async (query: string, profile?: Profile) => (await hub<{ hits?: TranscriptHit[] }>(`/api/assistant/transcripts/search?q=${encodeURIComponent(query)}${profile ? `&profile=${profile}` : ''}`)).hits ?? [];

  transcript = async (m: { profile: Profile; id: string }) => transcriptOf(await fetch(`/api/assistant${transcriptPath(m)}`));
}
