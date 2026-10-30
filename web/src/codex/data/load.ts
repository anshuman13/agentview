import { isBlock } from '../../../../shared/util';
import { decisionLog, factTime, live, type Chat, type Fact, type Meeting } from './wiki';
import { createdAt } from './review';
import { openQuestions, peopleOf, questionKey, seriesTitle } from './meetings';
import { statusTime } from './engine';
import { isSaid, type ItemRow } from './sync';

const HOUR = 3600_000;
const MAX_HOURS = 8;
const DAY = 24 * HOUR;
const SERIES_LIMIT = 8;

type LoadWeek = { start: number; hours: number; recorded: number; unrecorded: number };

// Calendar attendees without a display name come through as emails, so fold first.last@x into First Last.
const nameOf = (p: string) => (p.includes('@') ? p.split('@')[0].split(/[._]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : p);

const mondayOf = (now: number, back: number) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) - 7 * back).getTime();
};

// All-day calendar events start and end at local midnight (a day across a clock change is 23 or 25 hours).
const midnight = (t: number) => {
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0;
};
export const isAllDay = (m: Meeting) => m.ends_at! > m.starts_at! && midnight(m.starts_at!) && midnight(m.ends_at!);

// Minutes per recurring series (a title seen at least twice) over the last `weeks` weeks and the change against the `weeks` before (null when the series is new), most minutes first, with done and total meeting actions and the oldest open one's time.
function timeBySeries(meetings: Meeting[], items: ItemRow[], now: number, weeks: number) {
  const actions = new Map<string, ItemRow[]>();
  for (const r of items) {
    if (r.deleted || r.meeting_id == null || (r.status !== 'done' && r.status !== 'open')) continue;
    const k = `${r.profile}:${r.meeting_id}`;
    const list = actions.get(k);
    if (list) list.push(r);
    else actions.set(k, [r]);
  }
  const span = weeks * 7 * DAY;
  const sums = new Map<string, { title: string; at: number; minutes: number; before: number; count: number; done: number; total: number; oldestOpen: number | null }>();
  for (const m of live(meetings)) {
    if (m.starts_at == null || m.ends_at == null || m.ends_at <= m.starts_at || m.starts_at > now || m.starts_at < now - 2 * span || isAllDay(m)) continue;
    const title = seriesTitle(m.title);
    if (!title) continue;
    const key = `${m.profile}:${title}`;
    const row = sums.get(key) ?? { title: '', at: 0, minutes: 0, before: 0, count: 0, done: 0, total: 0, oldestOpen: null };
    row.count++;
    for (const a of actions.get(`${m.profile}:${m.id}`) ?? []) {
      row.total++;
      if (a.status === 'done') row.done++;
      else row.oldestOpen = Math.min(row.oldestOpen ?? a.updated_at, a.updated_at);
    }
    if (m.starts_at > row.at) Object.assign(row, { title: m.title ?? title, at: m.starts_at });
    const minutes = Math.min(Math.min(m.ends_at, now) - m.starts_at, MAX_HOURS * HOUR) / 60_000;
    if (m.starts_at >= now - span) row.minutes += minutes;
    else row.before += minutes;
    sums.set(key, row);
  }
  return [...sums]
    .filter(([, r]) => r.minutes > 0 && r.count > 1)
    .sort((a, b) => b[1].minutes - a[1].minutes || a[1].title.localeCompare(b[1].title))
    .slice(0, SERIES_LIMIT)
    .map(([key, r]) => ({ key, title: r.title, minutes: Math.round(r.minutes), change: r.before > 0 ? Math.round(r.minutes - r.before) : null, done: r.done, total: r.total, oldestOpen: r.oldestOpen }));
}

// Minutes of meetings still ahead between now and the end of the day, overlaps counted once, all-day events left out.
export function meetingTimeLeft(meetings: Meeting[], now: number, endOfDay: number) {
  const spans = meetings
    .filter((m) => m.starts_at != null && m.ends_at != null && !isAllDay(m))
    .map((m) => [Math.max(m.starts_at!, now), Math.min(m.ends_at!, endOfDay)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let until = now;
  for (const [a, b] of spans) {
    if (b <= until) continue;
    total += b - Math.max(a, until);
    until = b;
  }
  return Math.round(total / 60_000);
}

// Hours in meetings per week (Monday to Sunday, local time, oldest first, current week last) and who I shared the most hours with.
export const hoursText = (h: number) => `${h.toFixed(1)} h`;

export function meetingLoad(meetings: Meeting[], now: number, weeks = 4, items: ItemRow[] = []) {
  const starts = Array.from({ length: weeks }, (_, i) => mondayOf(now, weeks - 1 - i));
  const out: LoadWeek[] = starts.map((start) => ({ start, hours: 0, recorded: 0, unrecorded: 0 }));
  const shared = new Map<string, number>();
  for (const m of live(meetings)) {
    if (m.starts_at == null || m.ends_at == null || m.starts_at > now || m.starts_at < starts[0] || isAllDay(m)) continue;
    const at = m.starts_at;
    const week = [...out].reverse().find((w) => w.start <= at);
    if (!week) continue;
    const hours = Math.min(Math.max(Math.min(m.ends_at, now) - at, 0) / HOUR, MAX_HOURS);
    week.hours += hours;
    if ((m.recorded_ms ?? 0) > 0) week.recorded++;
    else week.unrecorded++;
    for (const p of new Set(peopleOf(m).map(nameOf))) shared.set(p, (shared.get(p) ?? 0) + hours);
  }
  const people = [...shared].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, hours]) => ({ name, hours }));
  return { weeks: out, people, series: timeBySeries(meetings, items, now, weeks) };
}

// What happened since Monday 00:00 local time: decisions, new current claims, finished tasks, still-open meeting actions and hours in meetings.
export function weekReview({ meetings, facts, items }: { meetings: Meeting[]; facts: Fact[]; items: ItemRow[] }, now: number) {
  const start = mondayOf(now, 0);
  const inWeek = (t: number) => t >= start && t <= now;
  const thisWeek = live(meetings).filter((m) => m.starts_at != null && inWeek(m.starts_at));
  const keys = new Set(thisWeek.map((m) => `${m.profile}:${m.id}`));
  return {
    start,
    meetings: thisWeek.length,
    hours: meetingLoad(meetings, now, 1).weeks[0].hours,
    decisions: decisionLog(meetings).filter((d) => inWeek(d.at)),
    claims: live(facts).filter((f) => !f.superseded_by && inWeek(factTime(f))).sort((a, b) => factTime(b) - factTime(a)),
    done: items.filter((r) => !r.deleted && r.status === 'done' && inWeek(statusTime(r))).sort((a, b) => statusTime(b) - statusTime(a)),
    open: items.filter((r) => !r.deleted && r.status === 'open' && r.source !== 'calendar' && r.meeting_id != null && keys.has(`${r.profile}:${r.meeting_id}`)),
  };
}

// Counts of what arrived after `since`: past meetings (not all-day), their decisions and open questions, and new current claims.
export function sinceLastVisit({ meetings, facts }: { meetings: Meeting[]; facts: Fact[] }, since: number, now: number, resolved: string[] = []) {
  const recent = live(meetings).filter((m) => m.starts_at != null && m.starts_at > since && m.starts_at <= now && !isAllDay(m) && !isBlock(m.id));
  return {
    meetings: recent.length,
    decisions: decisionLog(recent).length,
    claims: live(facts).filter((f) => !f.superseded_by && factTime(f) > since && factTime(f) <= now).length,
    questions: openQuestions(recent, now).filter((q) => !resolved.includes(questionKey(q))).length,
  };
}
