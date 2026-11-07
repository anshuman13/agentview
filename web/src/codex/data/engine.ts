import { FIELDS, TABLE_FIELDS, newId, parseTimes, rowToChange } from './sync';
import type { Change, ItemRow, Merged, Paused, Profile, PulledChange, Reply, ScanHealth, SyncRow } from './sync';

export const errorText = (err: unknown) => (err as Error | undefined)?.message || String(err);

export function toRow<R extends SyncRow = ItemRow>(m: Merged<R>): R {
  return { ...m, field_times: JSON.stringify(m.field_times) } as unknown as R;
}

export type Dirty = { table: string; row: SyncRow };

type SyncIO = {
  active(): boolean;
  since(): Promise<number>;
  saveSince(since: number): Promise<void>;
  dirty(): Promise<Dirty[]>;
  post(since: number, changes: Change[]): Promise<Reply>;
  clean(d: Dirty): Promise<void>;
  apply(change: PulledChange): Promise<void>;
  applyAll?(changes: PulledChange[]): Promise<void>;
  paused?(p: Paused[]): void;
  scans?(s: ScanHealth[]): void;
};

const BATCH_ROWS = 100;
const BATCH_BYTES = 1_000_000;

function takeBatch(rows: Dirty[]) {
  const batch: { row: Dirty; change: Change }[] = [];
  let bytes = 0;
  for (const row of rows.slice(0, BATCH_ROWS)) {
    const change = rowToChange(row.row, row.table);
    const size = JSON.stringify(change).length;
    if (batch.length && bytes + size > BATCH_BYTES) break;
    batch.push({ row, change });
    bytes += size;
  }
  return batch;
}

export async function runSync(io: SyncIO) {
  let since = await io.since();
  let queue = await io.dirty();
  let more = true;
  let changed = false;
  const rejected: { table: string; id: string; reason: string }[] = [];
  while (more && io.active()) {
    const batch = takeBatch(queue);
    queue = queue.slice(batch.length);
    const data = await io.post(since, batch.map((b) => b.change));
    if (!Array.isArray(data?.changes) || typeof data.version !== 'number') throw new Error('Unexpected hub response');
    io.paused?.(Array.isArray(data.paused) ? data.paused : []);
    io.scans?.(Array.isArray(data.scans) ? data.scans : []);
    const refused = Array.isArray(data.rejected) ? data.rejected : [];
    rejected.push(...refused);
    for (const { row } of batch) if (!refused.some((r) => r.table === row.table && r.id === row.row.id)) await io.clean(row);
    changed ||= batch.length > 0;
    if (queue.length) continue;
    const valid = data.changes.filter((change) => Object.hasOwn(TABLE_FIELDS, change?.table) && typeof change.id === 'string' && ['work', 'personal'].includes(change.profile));
    if (io.applyAll) await io.applyAll(valid);
    else for (const change of valid) await io.apply(change);
    changed ||= valid.length > 0;
    more = data.hasMore === true;
    if (more && data.version === since) throw new Error('Hub did not advance the sync version');
    since = data.version;
    await io.saveSince(since);
  }
  if (rejected.length) throw new Error(`${rejected.length} change${rejected.length > 1 ? 's' : ''} rejected: ${rejected[0].reason}`);
  return changed;
}

export function atTime(at: ItemRow['at']) {
  if (at == null || at === '') return null;
  const n = Number(at);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(String(at));
  return Number.isNaN(parsed) ? null : parsed;
}

export { SNOOZES, hasDay, nextNine, parseWhen, stripWhen, type Span, type When } from './when';

const ASK_RE = /^(what|when|who|whom|why|how|which|where|did|does|is|are|was|were|can|could|should|will|would|summari[sz]e|explain)\b/i;

export const isQuestion = (text: string) => /\?\s*$/.test(text) || ASK_RE.test(text.trim());

// Calendar rows were tasks before meetings had their own table; they stay hidden.
const isCalendar = (r: ItemRow) => r.source === 'calendar';
const statusTimes = new WeakMap<ItemRow, number>();
export const statusTime = (r: ItemRow) => {
  let t = statusTimes.get(r);
  if (t === undefined) statusTimes.set(r, t = parseTimes(r.field_times).status ?? r.updated_at);
  return t;
};

export function split(items: ItemRow[], profile: 'all' | Profile, now: number) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const due = new Map<ItemRow, number | null>();
  const changed = new Map<ItemRow, number>();
  const open: ItemRow[] = [], review: ItemRow[] = [], notes: ItemRow[] = [], doneToday: ItemRow[] = [];
  for (const r of items) {
    if (r.deleted || (profile !== 'all' && r.profile !== profile)) continue;
    if (r.status === 'open' && !isCalendar(r)) { open.push(r); due.set(r, atTime(r.at)); }
    else if (r.status === 'suggested') { review.push(r); changed.set(r, statusTime(r)); }
    else if (r.status === 'note') notes.push(r);
    else if (r.status === 'done') { const t = statusTime(r); if (t >= today) { doneToday.push(r); changed.set(r, t); } }
  }
  const at = (r: ItemRow) => due.get(r)!;
  const newest = (a: ItemRow, b: ItemRow) => changed.get(b)! - changed.get(a)!;
  open.sort((a, b) => (at(a) ?? 0) - (at(b) ?? 0) || a.updated_at - b.updated_at);
  return {
    overdue: open.filter((r) => at(r) != null && at(r)! < today),
    today: open.filter((r) => at(r) == null || (at(r)! >= today && at(r)! <= now)),
    later: open.filter((r) => (at(r) ?? 0) > now),
    review: review.sort(newest),
    notes: notes.sort((a, b) => b.updated_at - a.updated_at),
    doneToday: doneToday.sort(newest),
  };
}

export const reviewedSince = (r: ItemRow) => statusTime(r);

export const DIGEST_TITLE = 'Weekly digest';

export const latestDigest = (items: ItemRow[], profile: 'all' | Profile) =>
  items.filter((r) => !r.deleted && r.status === 'note' && r.title?.startsWith(DIGEST_TITLE) && (profile === 'all' || r.profile === profile)).sort((a, b) => b.updated_at - a.updated_at)[0];

export function splitTitle(text: string): { title: string; text: string | null } {
  const [first, ...rest] = text.split('\n');
  if (first.length <= 120) return { title: first, text: rest.join('\n').trim() || null };
  const space = first.lastIndexOf(' ', 120);
  const cut = space > 0 ? space : 120;
  return { title: first.slice(0, cut), text: [first.slice(cut).trim(), ...rest].join('\n').trim() || null };
}

// A task added from a meeting is an action of that meeting, labelled with its title.
export function newCapture(text: string, type: 'task' | 'note' | 'goal', profile: Profile, now: number, at: number | null = null, meeting: { id: string; title: string | null } | null = null): ItemRow {
  return {
    id: newId(),
    profile,
    version: 0,
    updated_at: now,
    deleted: 0,
    field_times: JSON.stringify({ title: now, text: now, source: now, status: now, ...(at != null && { at: now }), ...(meeting && { people: now, meeting_id: now }) }),
    ...splitTitle(text),
    source: meeting ? 'action' : type === 'goal' ? 'goal' : 'capture',
    source_url: null,
    people: meeting?.title ?? null,
    at,
    status: type === 'task' ? 'open' : type,
    meeting_id: meeting?.id ?? null,
    rolls: null,
    rolled_from: null,
    rank: null,
    dirty: 1,
  };
}

export function edited<T extends { field_times: string; updated_at: number }>(row: T, patch: Partial<T>, now: number): T {
  const times = parseTimes(row.field_times);
  // An edit always outdates the value it replaces, even when this device's clock is behind the one that wrote it.
  for (const k of Object.keys(patch)) times[k] = Math.max(now, (Number(times[k]) || 0) + 1);
  return { ...row, ...patch, field_times: JSON.stringify(times), updated_at: Math.max(row.updated_at, now), dirty: 1 };
}

// The item under the other profile keeps its id; every field is timed now, so it replaces a row moved away from there before.
export function moved(row: ItemRow, there: ItemRow | undefined, profile: Profile, now: number, goal: string | null = null): ItemRow {
  const fields = Object.fromEntries(FIELDS.map((f) => [f, row[f]])) as Partial<ItemRow>;
  // A weekly goal belongs to one profile, so the link does not move unless a move back restores it.
  return edited(there ?? { ...row, profile, version: 0, field_times: '{}' }, { ...fields, goal, deleted: 0 }, now);
}
