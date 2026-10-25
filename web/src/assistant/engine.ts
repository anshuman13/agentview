import { parseTimes, rowToChange } from './sync';
import type { Change, ItemRow, MergedRow, Profile, PulledChange, Reply } from './sync';

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

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const at = (base: Date, days: number, hour: number, minute = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour, minute).getTime();

export function nextNine(now = new Date()) {
  return at(now, 1, 9);
}

export const SNOOZES: { label: string; at: (now: Date) => number }[] = [
  { label: 'In 3 hours', at: (now) => now.getTime() + 3 * 3600_000 },
  { label: 'Tonight', at: (now) => (now.getHours() < 18 ? at(now, 0, 19) : at(now, 1, 19)) },
  { label: 'Tomorrow', at: (now) => nextNine(now) },
  { label: 'Next week', at: (now) => at(now, ((8 - now.getDay()) % 7) || 7, 9) },
];

const DATE_RE = /\b(today|tonight|tomorrow|tmrw|next week|(?:on )?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?)\b/i;
const TIME_RE = /\b(?:at |kl\.? )?(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\b/i;

export type When = { at: number; start: number; end: number };

// Reads one date word and an optional time ("tomorrow 9", "fri at 14:30", "tonight") from the text.
export function parseWhen(text: string, now = new Date()): When | null {
  const d = DATE_RE.exec(text);
  let days: number | null = null;
  let hour = 9;
  if (d) {
    const w = d[1].toLowerCase().replace(/^on /, '');
    if (w === 'today') days = 0;
    else if (w === 'tonight') { days = 0; hour = 19; }
    else if (w === 'tomorrow' || w === 'tmrw') days = 1;
    else if (w === 'next week') days = ((8 - now.getDay()) % 7) || 7;
    else {
      const i = DAYS.findIndex((n) => n.startsWith(w.slice(0, 3)));
      days = ((i - now.getDay() + 7) % 7) || 7;
    }
  }
  const rest = d ? text.slice(d.index + d[0].length) : text;
  const t = TIME_RE.exec(rest);
  const timed = t && (t[2] || t[3] || /^(at|kl)/i.test(t[0]) || (d && rest.slice(0, t.index).trim() === ''));
  if (!d && !timed) return null;
  let minute = 0;
  if (timed && t) {
    hour = Number(t[1]) % 24;
    minute = Number(t[2] ?? 0);
    if (t[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (t[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
    if (!t[3] && /tonight/i.test(d?.[1] ?? '') && hour < 12) hour += 12;
    if (minute > 59) return null;
  }
  if (days === null) days = at(now, 0, hour, minute) > now.getTime() ? 0 : 1;
  const offset = d ? d.index + d[0].length : 0;
  const start = d ? d.index : offset + t!.index;
  const end = timed && t ? offset + t.index + t[0].length : d!.index + d![0].length;
  return { at: at(now, days, hour, minute), start, end };
}

export function stripWhen(text: string, w: When | null) {
  if (!w) return text.trim();
  return (text.slice(0, w.start) + text.slice(w.end)).replace(/\s{2,}/g, ' ').trim();
}

const ASK_RE = /^(what|when|who|whom|why|how|which|where|did|do|does|is|are|was|were|can|could|should|will|would|summari[sz]e|plan|prep|prepare|find|show|list|tell|explain)\b/i;

export const isQuestion = (text: string) => /\?\s*$/.test(text) || ASK_RE.test(text.trim());

const MEETING_SOURCES = ['calendar', 'meeting'];
const DAY = 24 * 3600_000;

export function split(items: ItemRow[], profile: 'all' | Profile, now: number) {
  const mine = items.filter((r) => !r.deleted && (profile === 'all' || r.profile === profile));
  const open = mine.filter((r) => r.status === 'open').sort((a, b) => (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0) || a.updated_at - b.updated_at);
  const meeting = (r: ItemRow) => MEETING_SOURCES.includes(r.source ?? '');
  const isLater = (r: ItemRow) => (atTime(r.at) ?? 0) > now;
  return {
    next: open.filter((r) => meeting(r) && isLater(r) && atTime(r.at)! - now < 12 * 3600_000).slice(0, 1),
    today: open.filter((r) => !meeting(r) && !isLater(r)),
    later: open.filter((r) => !meeting(r) && isLater(r)),
    notes: mine.filter((r) => r.status === 'note').sort((a, b) => b.updated_at - a.updated_at),
    done: mine.filter((r) => r.status === 'done' && now - r.updated_at < 7 * DAY).sort((a, b) => b.updated_at - a.updated_at),
  };
}

export function newCapture(text: string, type: 'task' | 'note', profile: Profile, now: number, at: number | null = null): ItemRow {
  const [first, ...rest] = text.split('\n');
  return {
    id: crypto.randomUUID(),
    profile,
    version: 0,
    updated_at: now,
    deleted: 0,
    field_times: JSON.stringify({ title: now, text: now, source: now, status: now, ...(at != null && { at: now }) }),
    title: first.slice(0, 120),
    text: rest.join('\n').trim() || null,
    source: 'capture',
    source_url: null,
    people: null,
    at,
    status: type === 'note' ? 'note' : 'open',
    dirty: 1,
  };
}

export function edited<T extends { field_times: string; updated_at: number }>(row: T, patch: Partial<T>, now: number): T {
  const times = parseTimes(row.field_times);
  for (const k of Object.keys(patch)) times[k] = now;
  return { ...row, ...patch, field_times: JSON.stringify(times), updated_at: Math.max(row.updated_at, now), dirty: 1 };
}
