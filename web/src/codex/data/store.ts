import { edited, errorText } from './engine';
import type { ItemFields, ItemRow, Profile } from './sync';
import type { Table, Tables } from './wiki';

export const WIKI_TABLES: Table[] = ['pages', 'facts', 'meetings', 'actions'];

export type SyncStatus = { syncing: boolean; last: number; error: string };
export type Patch = Partial<Pick<ItemFields, 'title' | 'text' | 'status' | 'at'>> & { deleted?: number };
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
  capture(text: string, type: 'task' | 'note', profile: Profile, at?: number | null): Promise<ItemRow>;
  update(row: ItemRow, patch: Patch): Promise<void>;
  editRow<K extends Table>(table: K, row: Tables[K], patch: Partial<Tables[K]>): Promise<void>;
  syncNow(): Promise<void>;
  fetchTranscript(m: { profile: Profile; id: string }): Promise<number>;
}

export abstract class BaseStore {
  private subs = new Set<() => void>();
  private snap: Snapshot;
  private syncing = false;
  private again = false;

  constructor(phase: Snapshot['phase']) {
    this.snap = { phase, message: '', items: [], sync: { syncing: false, last: 0, error: '' }, pages: [], facts: [], meetings: [], actions: [] };
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

  protected abstract syncOnce(): Promise<void>;
  protected abstract refresh(): Promise<void>;

  syncNow = async () => {
    if (!this.ready) return;
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = true;
    this.setSync({ syncing: true });
    try {
      do {
        this.again = false;
        try {
          await this.syncOnce();
          if (this.ready) this.setSync({ last: Date.now(), error: '' });
        } catch (err) {
          if (this.ready) this.setSync({ error: errorText(err) });
        }
      } while (this.again && this.ready);
    } finally {
      this.syncing = false;
      this.setSync({ syncing: false });
    }
    await this.refresh().catch(() => {});
  };
}
