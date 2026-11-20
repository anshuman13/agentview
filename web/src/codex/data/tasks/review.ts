import { blockId, isBlock } from '../../../../../shared/util';
import { isLate, nameRe, waitingOn } from '../../../../../shared/waiting';
import { dayEnd, dayStart, pad, weekStart, ymd } from '../dates';
import { atTime, statusTime } from './engine';
import { goalsOf } from './goals';
import { packDay, workGaps, type Span } from './plan';
import { isSaid, parseTimes, type ItemRow } from '../sync';
import { sameName } from '../meetings/meetings';
import { listOf, live as liveRows, type Brief, type Chat, type Meeting } from '../wiki/wiki';

const DAY = 86400000;
const STUCK_ROLLS = 3;
const STUCK_DAYS = 30;

export const nextMonday = (now: number) => {
  const d = new Date(weekStart(now));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, 9).getTime();
};

const live = (r: ItemRow) => !r.deleted && r.source !== 'calendar';
const isOpen = (r: ItemRow) => live(r) && r.status === 'open';

// Creation time: the earliest field time, which is set when the row is captured.
export const createdAt = (r: ItemRow) => Math.min(r.updated_at, ...Object.values(parseTimes(r.field_times)).filter((t) => t > 0));
const ageDays = (r: ItemRow, now: number) => Math.max(0, Math.floor((now - createdAt(r)) / DAY));

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

// What the Slack scan read today and did not take as asks: one brief row per profile, newest first.
export type Ignored = { url: string; from: string; gist: string; at: number };

export function ignoredToday(briefs: Brief[], profile: string, now: number): Ignored[] {
  const day = ymd(now);
  return briefs.filter((b) => !b.deleted && b.kind === 'slack-ignored' && (profile === 'all' || b.profile === profile)).flatMap((b) => {
    try {
      const list = JSON.parse(b.rows ?? '[]');
      return Array.isArray(list) ? (list as Ignored[]).filter((e) => e.url && e.from && e.gist && ymd(e.at) === day) : [];
    } catch {
      return [];
    }
  }).sort((a, b) => b.at - a.at);
}

export type Waiting = { name: string; rows: { key: string; title: string; days: number; late: boolean; row?: ItemRow; url?: string }[] };

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
    add(name, { key: row.profile + row.id, title, days: ageDays(row, now), late: isLate(createdAt(row), now), row });
  }
  for (const w of mail) add(w.to, { key: `mail:${w.thread}`, title: w.subject, days: Math.max(0, Math.floor((now - w.sent_at) / DAY)), late: isLate(w.sent_at, now), url: w.url });
  for (const g of groups.values()) g.rows.sort((a, b) => Number(b.late) - Number(a.late) || b.days - a.days);
  return [...groups.values()].sort((a, b) => Number(b.rows[0].late) - Number(a.rows[0].late) || b.rows[0].days - a.rows[0].days || a.name.localeCompare(b.name));
}

export function nudgeText(g: Waiting) {
  const first = g.name.split(' ')[0];
  const what = g.rows.map((x) => x.title).join('; ');
  return `Hi ${first}, a quick nudge on ${what}. Any update when you have a moment? Thanks!`;
}

// The person a Slack or Gmail item names: "Ada · DM" for Slack, "Ada" for Gmail.
const personOf = (people: string | null) => (people ?? '').split(' · ')[0].replace(/<[^>]*>/, '').trim();
const isAsk = (r: ItemRow) => live(r) && (r.source === 'slack' || r.source === 'gmail') && (r.status === 'open' || r.status === 'suggested');

// Open tasks that name the person and are not already shown as their asks.
export const openTasksOf = (name: string, items: ItemRow[]) => items.filter((r) => isOpen(r) && !isAsk(r) && sameName(personOf(r.people), name));

// What waits between me and a person outside meetings: their DM summary, their asks to me, my promises to them and my unanswered mail.
export function personInbox(name: string, items: ItemRow[], chats: Chat[], mail: Unanswered[]) {
  const theirs = items.filter((r) => isAsk(r) && sameName(personOf(r.people), name));
  return {
    dm: liveRows(chats).find((c) => c.kind === 'dm' && c.summary && sameName(c.name ?? '', name)) ?? null,
    asks: theirs.filter((r) => !isSaid(r)),
    promises: theirs.filter((r) => isSaid(r)),
    mail: mail.filter((w) => sameName(personOf(w.to), name)),
  };
}

// The Monday to Friday day before now's day, as [start, end).
function prevWorkday(now: number): Span {
  const d = new Date(dayStart(now));
  do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6);
  return [d.getTime(), dayEnd(d.getTime())];
}

