import { decisionLog, factTime, live, peopleOf, type Fact, type Meeting } from './wiki';
import { parseTimes, type ItemRow } from './sync';

const HOUR = 3600_000;
const MAX_HOURS = 8;

export type LoadWeek = { start: number; hours: number; recorded: number; unrecorded: number };

// Calendar attendees without a display name come through as emails, so fold first.last@x into First Last.
const nameOf = (p: string) => (p.includes('@') ? p.split('@')[0].split(/[._]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : p);

const mondayOf = (now: number, back: number) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) - 7 * back).getTime();
};

// Hours in meetings per week (Monday to Sunday, local time, oldest first, current week last) and who I shared the most hours with.
export function meetingLoad(meetings: Meeting[], now: number, weeks = 4) {
  const starts = Array.from({ length: weeks }, (_, i) => mondayOf(now, weeks - 1 - i));
  const out: LoadWeek[] = starts.map((start) => ({ start, hours: 0, recorded: 0, unrecorded: 0 }));
  const shared = new Map<string, number>();
  for (const m of live(meetings)) {
    if (m.starts_at == null || m.ends_at == null || m.starts_at > now || m.starts_at < starts[0]) continue;
    const at = m.starts_at;
    const week = [...out].reverse().find((w) => w.start <= at);
    if (!week) continue;
    const hours = Math.min(Math.max(m.ends_at - at, 0) / HOUR, MAX_HOURS);
    week.hours += hours;
    if ((m.recorded_ms ?? 0) > 0) week.recorded++;
    else week.unrecorded++;
    for (const p of new Set(peopleOf(m).map(nameOf))) shared.set(p, (shared.get(p) ?? 0) + hours);
  }
  const people = [...shared].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, hours]) => ({ name, hours }));
  return { weeks: out, people };
}

// What happened since Monday 00:00 local time: decisions, new current claims, finished tasks, still-open meeting actions and hours in meetings.
export function weekReview({ meetings, facts, items }: { meetings: Meeting[]; facts: Fact[]; items: ItemRow[] }, now: number) {
  const start = mondayOf(now, 0);
  const inWeek = (t: number) => t >= start && t <= now;
  const thisWeek = live(meetings).filter((m) => m.starts_at != null && inWeek(m.starts_at));
  const keys = new Set(thisWeek.map((m) => `${m.profile}:${m.id}`));
  const doneAt = (r: ItemRow) => parseTimes(r.field_times).status ?? r.updated_at;
  return {
    start,
    meetings: thisWeek.length,
    hours: meetingLoad(meetings, now, 1).weeks[0].hours,
    decisions: decisionLog(meetings).filter((d) => inWeek(d.at)),
    claims: live(facts).filter((f) => !f.superseded_by && inWeek(factTime(f))).sort((a, b) => factTime(b) - factTime(a)),
    done: items.filter((r) => !r.deleted && r.status === 'done' && inWeek(doneAt(r))).sort((a, b) => doneAt(b) - doneAt(a)),
    open: items.filter((r) => !r.deleted && r.status === 'open' && r.source !== 'calendar' && r.meeting_id != null && keys.has(`${r.profile}:${r.meeting_id}`)),
  };
}
