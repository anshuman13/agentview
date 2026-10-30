export type Span = [number, number];

const EST_RE = /~\s*(?:(\d+)\s*h(?:\s*(\d+)\s*m?)?|(\d+)\s*m)\b/i;
const MIN_GAP = 15;

// Minutes from "~30m", "~1h" or "~1h30m" in a title, or null.
export function estimateMin(title: string | null) {
  const m = title?.match(EST_RE);
  if (!m) return null;
  const n = m[3] != null ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2] ?? 0);
  return n > 0 ? n : null;
}

export const minutesText = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? String(n % 60).padStart(2, '0') : ''}` : `${n}m`);

// Free spans between busy spans inside [from, to], gaps under 15 minutes dropped.
export function freeGaps(busy: Span[], from: number, to: number): Span[] {
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

// A block in the gap from start, minutes long, cut at the gap end; null when start is outside the gap or under 5 minutes are left.
export function fitBlock([from, to]: Span, start: number, minutes: number): Span | null {
  if (start < from || start >= to || !(minutes > 0)) return null;
  const end = Math.min(start + minutes * 60_000, to);
  return end - start >= SLOT ? [start, end] : null;
}

// The default block for a task: the gap start rounded up to 5 minutes, its estimate or 30 minutes, capped at the gap.
export function defaultBlock(gap: Span, title: string | null): Span | null {
  const start = Math.ceil(gap[0] / SLOT) * SLOT;
  return fitBlock(gap, start, estimateMin(title) ?? 30) ?? fitBlock(gap, gap[0], estimateMin(title) ?? 30);
}

export const focusTitle = (title: string | null) => `Focus: ${(title ?? '').replace(EST_RE, '').replace(/\s+/g, ' ').trim()}`;
