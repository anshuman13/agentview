export type Span = [number, number];

const EST_RE = /~\s*(?:(\d+)\s*h(?:\s*(\d+)\s*m?)?|(\d+)\s*m(?:ins?)?)\b/i;
const MIN_GAP = 15;

// Minutes from "~30m", "~1h" or "~1h30m" in a title, or null.
export function estimateMin(title: string | null) {
  const m = title?.match(EST_RE);
  if (!m) return null;
  const n = m[3] != null ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2] ?? 0);
  return n > 0 ? n : null;
}

const words = (title: string | null) => new Set((title ?? '').replace(EST_RE, '').toLowerCase().match(/\p{L}{3,}|\d+/gu) ?? []);

// The average actual minutes of done tasks whose titles share at least half their words with title, rounded to 5 minutes;
// null when fewer than 2 such tasks have actual minutes.
export function suggestEstimate(title: string | null, tasks: { title: string | null; status: string | null; spent?: number | null }[]) {
  const mine = words(title);
  if (!mine.size) return null;
  const mins = tasks.filter((t) => {
    if (t.status !== 'done' || !(Number(t.spent) > 0)) return false;
    const theirs = words(t.title);
    return [...mine].filter((w) => theirs.has(w)).length * 2 >= Math.max(mine.size, theirs.size);
  }).map((t) => Number(t.spent));
  if (mins.length < 2) return null;
  return Math.max(5, Math.round(mins.reduce((a, b) => a + b, 0) / mins.length / 5) * 5);
}

export const minutesText = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? String(n % 60).padStart(2, '0') : ''}` : `${n}m`);

// Free spans between busy spans inside [from, to], gaps under 15 minutes dropped.
function freeGaps(busy: Span[], from: number, to: number): Span[] {
  const out: Span[] = [];
  let at = from;
  for (const [a, b] of [...busy].sort((x, y) => x[0] - y[0])) {
    if (b <= at) continue;
    if (a > at) out.push([at, Math.min(a, to)]);
    at = Math.max(at, b);
    if (at >= to) break;
  }
  if (at < to) out.push([at, to]);
  return out.filter(([a, b]) => b - a >= MIN_GAP * 60_000);
}

// Free gaps from now to the end of work hours (08:00-17:00 local) around today's meetings.
export function workGaps(busy: Span[], now: number, startHour = 8, endHour = 17) {
  const d = new Date(now);
  const open = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startHour).getTime();
  const close = new Date(d.getFullYear(), d.getMonth(), d.getDate(), endHour).getTime();
  return freeGaps(busy, Math.max(now, open), close);
}

const SLOT = 5 * 60_000;
const DEFAULT_MIN = 30;
const taskMin = (title: string | null) => estimateMin(title) ?? DEFAULT_MIN;
const toSlot = (t: number) => Math.ceil(t / SLOT) * SLOT;

// A block in the gap from start, minutes long, cut at the gap end; null when start is outside the gap or under 5 minutes are left.
export function fitBlock([from, to]: Span, start: number, minutes: number): Span | null {
  if (start < from || start >= to || !(minutes > 0)) return null;
  const end = Math.min(start + minutes * 60_000, to);
  return end - start >= SLOT ? [start, end] : null;
}

// The default block for a task: the gap start rounded up to 5 minutes, its estimate or 30 minutes, capped at the gap.
export function defaultBlock(gap: Span, title: string | null): Span | null {
  return fitBlock(gap, toSlot(gap[0]), taskMin(title)) ?? fitBlock(gap, gap[0], taskMin(title));
}

export const focusTitle = (title: string | null) => `Focus: ${(title ?? '').replace(EST_RE, '').replace(/\s+/g, ' ').trim()}`;

// Places tasks into the gaps, tasks linked to a weekly goal first, then in due time order, then list order, each at the first
// gap start (rounded up to 5 minutes) with room for its whole estimate or 30 minutes; tasks that fit nowhere are left out.
export function packDay<T extends { title: string | null; due: number | null; goal?: boolean }>(tasks: T[], gaps: Span[]): { task: T; span: Span }[] {
  const free = gaps.map(([a, b]) => [a, b] as Span);
  const order = tasks.map((task, i) => ({ task, i })).sort((x, y) => Number(!!y.task.goal) - Number(!!x.task.goal) || (x.task.due ?? Infinity) - (y.task.due ?? Infinity) || x.i - y.i);
  const out: { task: T; span: Span }[] = [];
  for (const { task } of order) {
    const len = taskMin(task.title) * 60_000;
    for (const g of free) {
      const start = toSlot(g[0]);
      if (start + len > g[1]) continue;
      out.push({ task, span: [start, start + len] });
      g[0] = start + len;
      break;
    }
  }
  return out;
}

// Tasks due by the end of this week's Friday whose estimates, summed in due order, exceed the free work time before their
// due time; overdue tasks count as due at 17:00 today. short is the missing minutes.
export function atRisk<T extends { title: string | null; due: number }>(tasks: T[], busy: Span[], now: number, startHour = 8, endHour = 17): { task: T; short: number }[] {
  const d = new Date(now);
  const days = 5 - d.getDay();
  if (d.getDay() === 0 || days < 0) return [];
  const day = (i: number, h = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h).getTime();
  const gaps = Array.from({ length: days + 1 }, (_, i) => workGaps(busy, Math.max(now, day(i)), startHour, endHour)).flat();
  const freeBy = (t: number) => Math.round(gaps.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0) / 60_000);
  const close = day(0, endHour);
  const due = tasks
    .filter((t) => t.due < day(days + 1))
    .map((task) => ({ task, by: task.due < now ? Math.max(close, now) : task.due }))
    .sort((a, b) => a.by - b.by);
  const out: { task: T; short: number }[] = [];
  let need = 0;
  for (const { task, by } of due) {
    need += taskMin(task.title);
    const short = need - freeBy(by);
    if (short > 0) out.push({ task, short });
  }
  return out;
}
