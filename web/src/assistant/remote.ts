import { BaseStore, type AssistantStore } from './store';
import { edited, newCapture, nextNine, runSync, toRow } from './engine';
import { mergeIncoming } from './sync';
import type { Change, ItemRow, Profile, PulledChange, Reply } from './sync';

const SYNC_EVERY = 30000;

const call = (path: string, init?: RequestInit) => fetch(path, init);

async function hub(path: string, body?: unknown): Promise<Reply> {
  const resp = await call(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || `Server returned HTTP ${resp.status}`);
  return data;
}

const keyOf = (row: Pick<ItemRow, 'profile' | 'id'>) => `${row.profile}:${row.id}`;

export class RemoteStore extends BaseStore implements AssistantStore {
  readonly kind = 'remote';
  private rows = new Map<string, ItemRow>();
  private since = 0;

  constructor() {
    super('ready');
    setInterval(() => document.visibilityState === 'visible' && this.syncNow(), SYNC_EVERY);
    window.addEventListener('online', this.syncNow);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.syncNow());
  }

  async unlock() {
    await this.syncNow();
  }

  protected async refresh() {
    this.set({ items: [...this.rows.values()] });
  }

  protected syncOnce() {
    return runSync({
      active: () => true,
      since: async () => this.since,
      saveSince: async (since) => void (this.since = since),
      dirty: async () => [...this.rows.values()].filter((r) => r.dirty),
      post: (since, changes: Change[]) => (changes.length ? hub('/api/assistant/sync', { since, changes }) : hub(`/api/assistant/changes?since=${since}`)),
      clean: async (row) => {
        const now = this.rows.get(keyOf(row));
        if (now && now.updated_at === row.updated_at && now.field_times === row.field_times) this.rows.set(keyOf(row), { ...now, dirty: 0 });
      },
      apply: async (change: PulledChange) => {
        this.rows.set(keyOf(change), toRow(mergeIncoming(this.rows.get(keyOf(change)) ?? null, change)));
      },
    });
  }

  private put(row: ItemRow) {
    this.rows.set(keyOf(row), row);
    this.refresh();
    this.syncNow();
  }

  async capture(text: string, type: 'task' | 'note', profile: Profile) {
    this.put(newCapture(text, type, profile, Date.now()));
  }

  private edit(row: ItemRow, patch: Parameters<typeof edited>[1]) {
    this.put(edited(this.rows.get(keyOf(row)) ?? row, patch, Date.now()));
    return Promise.resolve();
  }

  done = (row: ItemRow) => this.edit(row, { status: 'done' });
  snooze = (row: ItemRow) => this.edit(row, { at: nextNine() });
  remove = (row: ItemRow) => this.edit(row, { deleted: 1 });
}
