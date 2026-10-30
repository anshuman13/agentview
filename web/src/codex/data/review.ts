import { atTime, statusTime } from './engine';
import { parseTimes, type ItemRow } from './sync';
import type { Brief } from './wiki';

const DAY = 86400000;
export const STUCK_ROLLS = 3;
export const STUCK_DAYS = 30;

export const weekStart = (now: number) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
};
export const nextMonday = (now: number) => {
  const d = new Date(weekStart(now));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, 9).getTime();
};

const live = (r: ItemRow) => !r.deleted && r.source !== 'calendar';
const isOpen = (r: ItemRow) => live(r) && r.status === 'open';

// Creation time: the earliest field time, which is set when the row is captured.
export const createdAt = (r: ItemRow) => Math.min(r.updated_at, ...Object.values(parseTimes(r.field_times)).filter((t) => t > 0));
export const ageDays = (r: ItemRow, now: number) => Math.max(0, Math.floor((now - createdAt(r)) / DAY));

export function weeklyReview(items: ItemRow[], now: number) {
  const start = weekStart(now);
  const end = start + 7 * DAY;
  const inWeek = (t: number | null) => t != null && t >= start && t < end;
  const done = items.filter((r) => live(r) && r.status === 'done' && inWeek(statusTime(r))).sort((a, b) => statusTime(b) - statusTime(a));
  const open = items.filter(isOpen);
  const slipped = open.filter((r) => {
    const due = r.rolled_from ?? atTime(r.at);
    const at = atTime(r.at);
    return inWeek(due) && (r.rolled_from != null || (at != null && at < now));
  });
  const stuck = open.filter((r) => (r.rolls ?? 0) >= STUCK_ROLLS || now - createdAt(r) > STUCK_DAYS * DAY).filter((r) => !slipped.includes(r));
  return { start, done, slipped, stuck };
}

const nameRe = /^(?:waiting\s+(?:on|for)\s+([^:,\-\n(]+)|@(\S+))/i;

export const waitingOn = (r: ItemRow): string | null => {
  const title = r.title?.trim() ?? '';
  const m = nameRe.exec(title);
  if (m) return (m[1] ?? m[2]).trim() || null;
  const first = r.people?.split(',')[0].trim();
  return first && /\bwaiting\b/i.test(`${title} ${r.text ?? ''}`) ? first : null;
};

// Sent mail the hub found with no reply after three workdays, kept as one brief row per profile.
export type Unanswered = { thread: string; url: string; to: string; subject: string; sent_at: number };

export function unanswered(briefs: Brief[]): Unanswered[] {
  return briefs.filter((b) => !b.deleted && b.kind === 'waiting').flatMap((b) => {
    try {
      const list = JSON.parse(b.text ?? '[]');
      return Array.isArray(list) ? (list as Unanswered[]).filter((w) => w.to && w.subject) : [];
    } catch {
      return [];
    }
  });
}

export type Waiting = { name: string; rows: { key: string; title: string; days: number; row?: ItemRow; url?: string }[] };

export function waitingByPerson(items: ItemRow[], now: number, mail: Unanswered[] = []): Waiting[] {
  const groups = new Map<string, Waiting>();
  const add = (name: string, row: Waiting['rows'][number]) => {
    const key = name.toLowerCase();
    const g = groups.get(key) ?? { name, rows: [] };
    g.rows.push(row);
    groups.set(key, g);
  };
  for (const row of items) {
    if (!isOpen(row)) continue;
    const name = waitingOn(row);
    if (!name) continue;
    const title = (row.title ?? '').replace(nameRe, '').replace(/^[\s:,\-]+/, '').trim() || row.title || '';
    add(name, { key: row.profile + row.id, title, days: ageDays(row, now), row });
  }
  for (const w of mail) add(w.to, { key: `mail:${w.thread}`, title: w.subject, days: Math.max(0, Math.floor((now - w.sent_at) / DAY)), url: w.url });
  for (const g of groups.values()) g.rows.sort((a, b) => b.days - a.days);
  return [...groups.values()].sort((a, b) => b.rows[0].days - a.rows[0].days || a.name.localeCompare(b.name));
}

export function nudgeText(g: Waiting) {
  const first = g.name.split(' ')[0];
  const what = g.rows.map((x) => x.title).join('; ');
  return `Hi ${first}, a quick nudge on ${what}. Any update when you have a moment? Thanks!`;
}
