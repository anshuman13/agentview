import { errorText } from './engine';
import type { ItemRow, Profile } from './sync';

export type SyncStatus = { syncing: boolean; last: number; error: string };
export type Snapshot = { phase: 'locked' | 'unlocking' | 'ready'; message: string; items: ItemRow[]; sync: SyncStatus };

export interface AssistantStore {
  readonly kind: 'local' | 'remote';
  subscribe(fn: () => void): () => void;
  snapshot(): Snapshot;
  unlock(): Promise<void>;
  capture(text: string, type: 'task' | 'note', profile: Profile): Promise<void>;
  done(row: ItemRow): Promise<void>;
  snooze(row: ItemRow): Promise<void>;
  remove(row: ItemRow): Promise<void>;
  syncNow(): Promise<void>;
}

export abstract class BaseStore {
  private subs = new Set<() => void>();
  private snap: Snapshot;
  private syncing = false;
  private again = false;

  constructor(phase: Snapshot['phase']) {
    this.snap = { phase, message: '', items: [], sync: { syncing: false, last: 0, error: '' } };
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
