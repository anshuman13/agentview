import { blockId, isBlock } from '../../../../shared/util';
import { dayEnd, dayStart, pad } from './dates';
import { atTime, statusTime } from './engine';
import { goalsOf } from './goals';
import { packDay, workGaps, type Span } from './plan';
import { parseTimes, type ItemRow } from './sync';
import { isAllDay } from './load';
import { peopleOf, sameName } from './meetings';
import { listOf, live as liveRows, type Brief, type Chat, type Meeting } from './wiki';

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

// The person a Slack or Gmail item names: "Ada · DM" for Slack, "Ada" for Gmail.
const personOf = (people: string | null) => (people ?? '').split(' · ')[0].replace(/<[^>]*>/, '').trim();
const isAsk = (r: ItemRow) => live(r) && (r.source === 'slack' || r.source === 'gmail') && (r.status === 'open' || r.status === 'suggested');

// What waits between me and a person outside meetings: their DM summary, their asks to me, my promises to them and my unanswered mail.
export function personInbox(name: string, items: ItemRow[], chats: Chat[], mail: Unanswered[]) {
  const theirs = items.filter((r) => isAsk(r) && sameName(personOf(r.people), name));
  return {
    dm: liveRows(chats).find((c) => c.kind === 'dm' && c.summary && sameName(c.name ?? '', name)) ?? null,
    asks: theirs.filter((r) => !r.id.startsWith('said:')),
    promises: theirs.filter((r) => r.id.startsWith('said:')),
    mail: mail.filter((w) => sameName(personOf(w.to), name)),
  };
}

const WINDOW = 56 * DAY;
const MAX_PEOPLE = 8;

export type Lapsed = { name: string; key: string; last: number; gap: number; since: number };

// People I met or DMed on 3+ days in the last 8 weeks whose time since the last contact is over 1.5x their median gap, most overdue first.
// Meetings with more than 8 people do not count as contact.
export function keepInTouch(meetings: Meeting[], chats: Chat[], items: ItemRow[], now: number, dismissed: string[] = []): Lapsed[] {
  const from = now - WINDOW;
  const days = new Map<string, { name: string; days: Set<number> }>();
  const add = (name: string, t: number | null) => {
    if (!name || t == null || t < from || t > now) return;
    const k = name.toLowerCase();
    const p = days.get(k) ?? { name, days: new Set<number>() };
    p.days.add(dayStart(t));
    days.set(k, p);
  };
  for (const m of liveRows(meetings)) {
    if (m.starts_at == null || isBlock(m.id) || (m.ends_at != null && isAllDay(m))) continue;
    const people = peopleOf(m);
    if (people.length <= MAX_PEOPLE) for (const p of people) add(p, m.starts_at);
  }
  for (const c of liveRows(chats)) if (c.kind === 'dm') add(c.name?.trim() ?? '', c.last_at);
  for (const r of items) if (live(r) && r.source === 'slack' && / · DM$/.test(r.people ?? '')) add(personOf(r.people), createdAt(r));
  const out: Lapsed[] = [];
  for (const [k, { name, days: set }] of days) {
    if (set.size < 3) continue;
    const ts = [...set].sort((a, b) => a - b);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    const gap = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
    const last = ts[ts.length - 1];
    const since = now - last;
    const key = `${k}:${last}`;
    if (since > 1.5 * gap && !dismissed.includes(key)) out.push({ name, key, last, gap, since });
  }
  return out.sort((a, b) => b.since / b.gap - a.since / a.gap || a.name.localeCompare(b.name));
}

export const touchText = (name: string) => `Hi ${name.split(' ')[0]}, it has been a while! Up for a quick catch-up this week?`;
// The Monday to Friday day before now's day, as [start, end).
export function prevWorkday(now: number): Span {
  const d = new Date(dayStart(now));
  do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6);
  return [d.getTime(), dayEnd(d.getTime())];
}

export const BLOCKED_DAYS = 2;
const hm = (t: number) => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`;

// Standup text: what was done and decided on the previous workday, today's meetings and the tasks Plan my day would place,
// and waiting-on items older than two days. meetings holds focus blocks too; plan is the overdue and due-today tasks, and tasks
// for this week's goals join them first, as in Plan my day.
export function standupText(items: ItemRow[], meetings: Meeting[], plan: ItemRow[], now: number) {
  const [from, to] = prevWorkday(now);
  const inPrev = (t: number | null) => t != null && t >= from && t < to;
  const done = items.filter((r) => live(r) && r.status === 'done' && inPrev(statusTime(r))).map((r) => r.title ?? '');
  const decided = meetings.filter((m) => inPrev(m.starts_at)).flatMap((m) => listOf(m.decisions).map((d) => `Decided: ${d} (${m.title})`));
  const today = meetings.filter((m) => m.starts_at != null && m.ends_at != null && m.starts_at >= dayStart(now) && m.starts_at < dayEnd(now) && m.ends_at > m.starts_at && m.ends_at - m.starts_at < 20 * 3600_000);
  const blocked = new Set(today.filter((m) => isBlock(m.id) && m.ends_at! > now).map((m) => `${m.profile}:${m.id}`));
  const goals = new Set(goalsOf(items, now).map((g) => `${g.profile}:${g.id}`));
  const forGoal = (r: ItemRow) => !!r.goal && goals.has(`${r.profile}:${r.goal}`);
  const listed = new Set(plan.map((r) => `${r.profile}:${r.id}`));
  const goalTasks = items.filter((r) => isOpen(r) && forGoal(r) && !listed.has(`${r.profile}:${r.id}`));
  const tasks = [...plan, ...goalTasks].filter((r) => !blocked.has(`${r.profile}:${blockId(r.id)}`)).map((r) => ({ title: r.title, due: atTime(r.at), goal: forGoal(r) }));
  const packed = packDay(tasks, workGaps(today.map((m) => [m.starts_at!, m.ends_at!] as Span), now));
  const timed = [...today.map((m) => ({ at: m.starts_at!, text: m.title ?? '' })), ...packed.map((p) => ({ at: p.span[0], text: p.task.title ?? '' }))].sort((a, b) => a.at - b.at);
  const placed = new Set(packed.map((p) => p.task));
  const waiting = waitingByPerson(items, now).flatMap((g) => g.rows.filter((x) => x.days > BLOCKED_DAYS).map((x) => `${g.name}: ${x.title} (${x.days} days)`));
  const section = (head: string, lines: string[]) => `${head}\n${lines.length ? lines.map((l) => `- ${l}`).join('\n') : 'Nothing'}`;
  return [
    section('Yesterday', [...done, ...decided]),
    section('Today', [...timed.map((x) => `${hm(x.at)} ${x.text}`), ...tasks.filter((t) => !placed.has(t)).map((t) => t.title ?? '')]),
    section('Blocked', waiting),
  ].join('\n\n');
}
