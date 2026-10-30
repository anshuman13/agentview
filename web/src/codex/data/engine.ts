import { WEEKDAYS } from './dates';
import { FIELDS, TABLE_FIELDS, newId, parseTimes, rowToChange } from './sync';
import type { Run } from './wiki';
import type { Change, ItemRow, Merged, Paused, Profile, PulledChange, Reply, SyncRow } from './sync';

export const errorText = (err: unknown) => (err as Error | undefined)?.message || String(err);

export function toRow<R extends SyncRow = ItemRow>(m: Merged<R>): R {
  return { ...m, field_times: JSON.stringify(m.field_times) } as unknown as R;
}

export type Dirty = { table: string; row: SyncRow };

export type SyncIO = {
  active(): boolean;
  since(): Promise<number>;
  saveSince(since: number): Promise<void>;
  dirty(): Promise<Dirty[]>;
  post(since: number, changes: Change[]): Promise<Reply>;
  clean(d: Dirty): Promise<void>;
  apply(change: PulledChange): Promise<void>;
  paused?(p: Paused[]): void;
};

export async function runSync(io: SyncIO) {
  let since = await io.since();
  let pushed = await io.dirty();
  let more = true;
  let changed = false;
  while (more && io.active()) {
    const data = await io.post(since, pushed.map((d) => rowToChange(d.row, d.table)));
    if (!Array.isArray(data?.changes) || typeof data.version !== 'number') throw new Error('Unexpected hub response');
    io.paused?.(Array.isArray(data.paused) ? data.paused : []);
    for (const row of pushed) await io.clean(row);
    changed ||= pushed.length > 0;
    pushed = [];
    for (const change of data.changes) {
      if (!Object.hasOwn(TABLE_FIELDS, change?.table) || typeof change.id !== 'string' || !['work', 'personal'].includes(change.profile)) continue;
      await io.apply(change);
      changed = true;
    }
    more = data.hasMore === true;
    if (more && data.version <= since) throw new Error('Hub did not advance the sync version');
    since = data.version;
    await io.saveSince(since);
  }
  return changed;
}

export function atTime(at: ItemRow['at']) {
  if (at == null || at === '') return null;
  const n = Number(at);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(String(at));
  return Number.isNaN(parsed) ? null : parsed;
}

const at = (base: Date, days: number, hour: number, minute = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour, minute).getTime();

export function nextNine(now = new Date()) {
  return at(now, 1, 9);
}

export const SNOOZES: { label: string; at: (now: Date) => number }[] = [
  { label: 'In 1 hour', at: (now) => Math.ceil((now.getTime() + 3600_000) / 60_000) * 60_000 },
  { label: 'In 3 hours', at: (now) => now.getTime() + 3 * 3600_000 },
  { label: 'Tonight', at: (now) => (now.getHours() < 19 ? at(now, 0, 19) : at(now, 1, 19)) },
  { label: 'Tomorrow', at: (now) => nextNine(now) },
  { label: 'Next week', at: (now) => at(now, ((8 - now.getDay()) % 7) || 7, 9) },
];

const DATE_RE = /\b(today|tomorrow|tmrw|next week|(?:on )?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?)\b/i;
// True when the text names a day or a relative time, not only a time of day.
export const hasDay = (text: string) => DATE_RE.test(text) || REL_RE.test(text);
const PART_RE = /\b(?:this |in the )?(morning|noon|lunch|afternoon|evening|tonight)\b/i;
const TIME_RE = /\b(?:at |kl\.? )?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)?\b(?!\s*(?:min|hour|hr|h\b|day|week|%))/i;
const REL_RE = /\b(?:in\s+(an?|one|half an?|\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|weeks?)\b(?:\s+from now)?|(an?|one|\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\s+(?:from now|later)\b)/i;
const PARTS: Record<string, number> = { morning: 9, noon: 12, lunch: 12, afternoon: 14, evening: 19, tonight: 19 };
const UNIT: Record<string, number> = { m: 60_000, h: 3600_000 };
const DAY_UNIT: Record<string, number> = { d: 1, w: 7 };

export type Span = [number, number];
export type When = { at: number | null; spans: Span[] };

const span = (m: RegExpExecArray, offset = 0): Span => [offset + m.index, offset + m.index + m[0].length];

// Reads a date and time from the text: "in 1 hour", "2 hours from now", "tomorrow 9", "fri at 14:30", "this evening", "today".
// "today" without a time gives at = null, which keeps the task in Today.
export function parseWhen(text: string, now = new Date()): When | null {
  const r = REL_RE.exec(text);
  if (r) {
    const n = r[1] ?? r[3];
    const unit = (r[2] ?? r[4]).toLowerCase();
    const amount = /^half/i.test(n) ? 0.5 : /^(an?|one)$/i.test(n) ? 1 : Number(n);
    const key = unit === 'm' || unit.startsWith('min') ? 'm' : unit[0];
    const target = new Date(now);
    if (key in DAY_UNIT && Number.isInteger(amount * DAY_UNIT[key])) target.setDate(target.getDate() + amount * DAY_UNIT[key]);
    else if (key in DAY_UNIT) target.setTime(now.getTime() + amount * DAY_UNIT[key] * 86_400_000);
    else target.setTime(now.getTime() + amount * UNIT[key]);
    return { at: Math.ceil(target.getTime() / 60_000) * 60_000, spans: [span(r)] };
  }
  const d = DATE_RE.exec(text);
  const p = PART_RE.exec(text);
  let days: number | null = null;
  let hour: number | null = p ? PARTS[p[1].toLowerCase()] : null;
  if (d) {
    const w = d[1].toLowerCase().replace(/^on /, '');
    if (w === 'today') days = 0;
    else if (w === 'tomorrow' || w === 'tmrw') days = 1;
    else if (w === 'next week') days = ((8 - now.getDay()) % 7) || 7;
    else {
      const i = WEEKDAYS.findIndex((n) => n.startsWith(w.slice(0, 3)));
      days = ((i - now.getDay() + 7) % 7) || 7;
    }
  }
  const anchor = d && p ? (d.index > p.index ? d : p) : d ?? p;
  const offset = anchor ? anchor.index + anchor[0].length : 0;
  const rest = text.slice(offset);
  const t = TIME_RE.exec(rest);
  const timed = t && (t[2] || t[3] || /^(at|kl)/i.test(t[0]) || (anchor && rest.slice(0, t.index).trim() === ''));
  if (!d && !p && !timed) return null;
  const spans: Span[] = [d, p].filter((m): m is RegExpExecArray => !!m).map((m) => span(m));
  let minute = 0;
  if (timed && t) {
    let h = Number(t[1]);
    minute = Number(t[2] ?? 0);
    if (h > 23 || minute > 59) return null;
    const ampm = t[3]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (!ampm && hour != null && hour >= 12 && h < 12) h += 12;
    hour = h;
    spans.push(span(t, offset));
  }
  if (hour == null) {
    if (days === 0) return { at: null, spans };
    hour = 9;
  }
  if (days === null) days = at(now, 0, hour, minute) > now.getTime() ? 0 : 1;
  return { at: at(now, days, hour, minute), spans: spans.sort((a, b) => a[0] - b[0]) };
}

export function stripWhen(text: string, w: When | null) {
  let out = text;
  for (const [s, e] of [...(w?.spans ?? [])].sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + out.slice(e);
  return out.replace(/^\s*(?:add a task to|add a task|remind me to|reminder to)\s+/i, '').replace(/[\s,]*(?:and )?(?:set|add) a reminder\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
}

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

export const STALE_DAYS = 14;

export function staleTasks(items: ItemRow[], now: number) {
  const cutoff = now - STALE_DAYS * 86400000;
  const changed = (r: ItemRow) => Math.max(r.updated_at, statusTime(r));
  return items.filter((r) => !r.deleted && r.status === 'open' && !isCalendar(r) && changed(r) < cutoff).sort((a, b) => changed(a) - changed(b));
}

// The newest finished run with output per job since a time, in one pass over the runs.
export function latestRunByJob(runs: Run[], since: number) {
  const best = new Map<string, Run>();
  for (const r of runs) {
    if (r.deleted || r.status !== 'ok' || !r.output || (r.started_at ?? 0) < since) continue;
    const key = r.profile + r.job_id;
    const cur = best.get(key);
    if (!cur || r.started_at! > cur.started_at!) best.set(key, r);
  }
  return best;
}

export const reviewedSince = (r: ItemRow) => statusTime(r);

export const DIGEST_TITLE = 'Weekly digest';

export const latestDigest = (items: ItemRow[], profile: 'all' | Profile) =>
  items.filter((r) => !r.deleted && r.status === 'note' && r.title?.startsWith(DIGEST_TITLE) && (profile === 'all' || r.profile === profile)).sort((a, b) => b.updated_at - a.updated_at)[0];

// A task added from a meeting is an action of that meeting, labelled with its title.
export function newCapture(text: string, type: 'task' | 'note', profile: Profile, now: number, at: number | null = null, meeting: { id: string; title: string | null } | null = null): ItemRow {
  const [first, ...rest] = text.split('\n');
  return {
    id: newId(),
    profile,
    version: 0,
    updated_at: now,
    deleted: 0,
    field_times: JSON.stringify({ title: now, text: now, source: now, status: now, ...(at != null && { at: now }), ...(meeting && { people: now, meeting_id: now }) }),
    title: first.slice(0, 120),
    text: rest.join('\n').trim() || null,
    source: meeting ? 'action' : 'capture',
    source_url: null,
    people: meeting?.title ?? null,
    at,
    status: type === 'note' ? 'note' : 'open',
    meeting_id: meeting?.id ?? null,
    rolls: null,
    rolled_from: null,
    rank: null,
    dirty: 1,
  };
}

export function edited<T extends { field_times: string; updated_at: number }>(row: T, patch: Partial<T>, now: number): T {
  const times = parseTimes(row.field_times);
  for (const k of Object.keys(patch)) times[k] = now;
  return { ...row, ...patch, field_times: JSON.stringify(times), updated_at: Math.max(row.updated_at, now), dirty: 1 };
}

// The item under the other profile keeps its id; every field is timed now, so it replaces a row moved away from there before.
export function moved(row: ItemRow, there: ItemRow | undefined, profile: Profile, now: number): ItemRow {
  const fields = Object.fromEntries(FIELDS.map((f) => [f, row[f]])) as Partial<ItemRow>;
  return edited(there ?? { ...row, profile, version: 0, field_times: '{}' }, { ...fields, deleted: 0 }, now);
}
