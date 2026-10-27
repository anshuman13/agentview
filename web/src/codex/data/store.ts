import { edited, errorText } from './engine';
import type { ItemFields, ItemRow, Profile } from './sync';
import type { Table, Tables } from './wiki';

export const WIKI_TABLES: Table[] = ['pages', 'facts', 'meetings', 'actions', 'jobs', 'runs', 'chats', 'briefs'];

export type SyncStatus = { syncing: boolean; last: number; error: string };
export type Patch = Partial<Pick<ItemFields, 'title' | 'text' | 'status' | 'at' | 'rolls' | 'rolled_from'>> & { deleted?: number };
export type Parsed = { title: string; details: string | null; at: number | null };
export type MeetingRef = { id: string; title: string | null } | null;
export type Snapshot = {
  phase: 'locked' | 'unlocking' | 'ready';
  message: string;
  items: ItemRow[];
  sync: SyncStatus;
} & { [K in Table]: Tables[K][] };

export interface AssistantStore {
  readonly kind: 'local' | 'remote';
  subscribe(fn: () => void): () => void;
  snapshot(): Snapshot;
  unlock(): Promise<void>;
  capture(text: string, type: 'task' | 'note', profile: Profile, at?: number | null, meeting?: MeetingRef): Promise<ItemRow>;
  update(row: ItemRow, patch: Patch): Promise<void>;
  editRow<K extends Table>(table: K, row: Tables[K], patch: Partial<Tables[K]>): Promise<void>;
  syncNow(): Promise<void>;
  parse(text: string, profile: Profile): Promise<Parsed>;
  fetchTranscript(m: { profile: Profile; id: string }): Promise<number>;
  syncCalendar(fresh?: number): Promise<number>;
  summarizeSlack(): Promise<number>;
}

export abstract class BaseStore {
  private subs = new Set<() => void>();
  private snap: Snapshot;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(phase: Snapshot['phase']) {
    this.snap = { phase, message: '', items: [], sync: { syncing: false, last: 0, error: '' }, pages: [], facts: [], meetings: [], actions: [], jobs: [], runs: [], chats: [], briefs: [] };
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };

  snapshot = () => this.snap;

  protected set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.subs.forEach((fn) => fn());
  }

  protected setSync(patch: Partial<SyncStatus>) {
    this.set({ sync: { ...this.snap.sync, ...patch } });
  }

  protected get ready() {
    return this.snap.phase === 'ready';
  }

  // Wiki and meeting rows stay in memory until their sync lands; an edit to a row not held yet adds it.
  editRow = async <K extends Table>(table: K, row: Tables[K], patch: Partial<Tables[K]>) => {
    const rows = this.snap[table] as Tables[K][];
    const same = (r: Tables[K]) => r.profile === row.profile && r.id === row.id;
    const next = edited(rows.find(same) ?? row, patch, Date.now());
    this.set({ [table]: rows.some(same) ? rows.map((r) => (same(r) ? next : r)) : [...rows, next] } as Partial<Snapshot>);
  };

  // Resolves true when it pushed or pulled any row.
  protected abstract syncOnce(): Promise<boolean>;
  protected abstract refresh(): Promise<void>;

  // A call while a sync runs resolves after one more full sync, so it sees the changes made before the call.
  syncNow = (): Promise<void> => {
    if (!this.ready) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    return (this.running = this.loop().finally(() => (this.running = null)));
  };

  private async loop() {
    this.setSync({ syncing: true });
    try {
      do {
        this.again = false;
        let changed = true;
        try {
          changed = await this.syncOnce();
          if (this.ready) this.setSync({ last: Date.now(), error: '' });
        } catch (err) {
          if (this.ready) this.setSync({ error: errorText(err) });
        }
        if (changed) await this.refresh().catch(() => {});
      } while (this.again && this.ready);
    } finally {
      this.setSync({ syncing: false });
    }
  }
}
