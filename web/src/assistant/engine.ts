import { parseTimes, rowToChange } from './sync';
import type { Change, ItemFields, ItemRow, MergedRow, Profile, PulledChange, Reply } from './sync';

export const errorText = (err: unknown) => (err as Error | undefined)?.message || String(err);

export function toRow(m: MergedRow): ItemRow {
  return { ...m, field_times: JSON.stringify(m.field_times) };
}

export type SyncIO = {
  active(): boolean;
  since(): Promise<number>;
  saveSince(since: number): Promise<void>;
  dirty(): Promise<ItemRow[]>;
  post(since: number, changes: Change[]): Promise<Reply>;
  clean(row: ItemRow): Promise<void>;
  apply(change: PulledChange): Promise<void>;
};

export async function runSync(io: SyncIO) {
  let since = await io.since();
  let pushed = await io.dirty();
  let more = true;
  while (more && io.active()) {
    const data = await io.post(since, pushed.map(rowToChange));
    if (!Array.isArray(data?.changes) || typeof data.version !== 'number') throw new Error('Unexpected hub response');
    for (const row of pushed) await io.clean(row);
    pushed = [];
    for (const change of data.changes) {
      if (change?.table !== 'items' || typeof change.id !== 'string' || !['work', 'personal'].includes(change.profile)) continue;
      await io.apply(change);
    }
    more = data.hasMore === true;
    if (more && data.version <= since) throw new Error('Hub did not advance the sync version');
    since = data.version;
    await io.saveSince(since);
  }
}

export function atTime(at: ItemRow['at']) {
  if (at == null || at === '') return null;
  const n = Number(at);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(String(at));
  return Number.isNaN(parsed) ? null : parsed;
}

export function nextNine(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9).getTime();
}

export function split(items: ItemRow[], profile: 'all' | Profile, now: number) {
  const mine = items.filter((r) => !r.deleted && (profile === 'all' || r.profile === profile));
  const open = mine.filter((r) => r.status === 'open').sort((a, b) => (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0) || a.updated_at - b.updated_at);
  const isLater = (r: ItemRow) => (atTime(r.at) ?? 0) > now;
  return {
    today: open.filter((r) => !isLater(r)),
    later: open.filter(isLater),
    notes: mine.filter((r) => r.status === 'note').sort((a, b) => b.updated_at - a.updated_at),
  };
}

export function newCapture(text: string, type: 'task' | 'note', profile: Profile, now: number): ItemRow {
  const [first, ...rest] = text.split('\n');
  return {
    id: crypto.randomUUID(),
    profile,
    version: 0,
    updated_at: now,
    deleted: 0,
    field_times: JSON.stringify({ title: now, text: now, source: now, status: now }),
    title: first.slice(0, 120),
    text: rest.join('\n').trim() || null,
    source: 'capture',
    source_url: null,
    people: null,
    at: null,
    status: type === 'note' ? 'note' : 'open',
    dirty: 1,
  };
}

export function edited(row: ItemRow, patch: Partial<ItemFields> & { deleted?: number }, now: number): ItemRow {
  const times = parseTimes(row.field_times);
  for (const k of Object.keys(patch)) times[k] = now;
  return { ...row, ...patch, field_times: JSON.stringify(times), updated_at: Math.max(row.updated_at, now), dirty: 1 };
}
