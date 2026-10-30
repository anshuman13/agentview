import { edited, errorText } from './engine';
import type { ItemFields, ItemRow, Paused, Profile } from './sync';
import type { Table, Tables } from './wiki';

export const WIKI_TABLES: Table[] = ['pages', 'facts', 'meetings', 'actions', 'jobs', 'runs', 'chats', 'briefs'];

export type SyncStatus = { syncing: boolean; last: number; error: string; paused: Paused[] };
export type Patch = Partial<Pick<ItemFields, 'title' | 'text' | 'status' | 'at' | 'meeting_id' | 'rolls' | 'rolled_from' | 'rank' | 'source' | 'people' | 'spent' | 'goal'>> & { deleted?: number };
export type Parsed = { title: string; details: string | null; at: number | null };
export type MeetingRef = { id: string; title: string | null } | null;
export type TranscriptHit = { profile: Profile; id: string; snippet: string };
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
  capture(text: string, type: 'task' | 'note' | 'goal', profile: Profile, at?: number | null, meeting?: MeetingRef): Promise<ItemRow>;
  update(row: ItemRow, patch: Patch): Promise<void>;
  move(row: ItemRow, profile: Profile): Promise<void>;
  editRow<K extends Table>(table: K, row: Tables[K], patch: Partial<Tables[K]>): Promise<void>;
  syncNow(): Promise<void>;
  parse(text: string, profile: Profile): Promise<Parsed>;
  fetchTranscript(m: { profile: Profile; id: string }, instructions?: string): Promise<number>;
  syncCalendar(fresh?: number): Promise<number>;
  blockTime(row: ItemRow, start: number, end: number, title: string): Promise<void>;
  summarizeSlack(): Promise<number>;
  searchTranscripts(query: string, profile?: Profile): Promise<TranscriptHit[]>;
  transcript(m: { profile: Profile; id: string }): Promise<string | null>;
}

export const transcriptPath = (m: { profile: Profile; id: string }) => `/transcript?profile=${m.profile}&id=${encodeURIComponent(m.id)}`;

// A meeting without stored transcript text answers 404.
export async function transcriptOf(resp: Response) {
  if (resp.status === 404) return null;
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || `Hub returned HTTP ${resp.status}`);
  return typeof data?.text === 'string' ? data.text : null;
}

export abstract class BaseStore {
  private subs = new Set<() => void>();
  private snap: Snapshot;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(phase: Snapshot['phase']) {
    this.snap = { phase, message: '', items: [], sync: { syncing: false, last: 0, error: '', paused: [] }, pages: [], facts: [], meetings: [], actions: [], jobs: [], runs: [], chats: [], briefs: [] };
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
    const at = rows.findIndex((r) => r.profile === row.profile && r.id === row.id);
    const next = edited(at < 0 ? row : rows[at], patch, Date.now());
    this.set({ [table]: at < 0 ? [...rows, next] : rows.map((r, i) => (i === at ? next : r)) } as Partial<Snapshot>);
  };

  // Resolves true when it pushed or pulled any row.
  protected abstract syncOnce(): Promise<boolean>;
  protected abstract refresh(tables?: string[]): Promise<void>;

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
