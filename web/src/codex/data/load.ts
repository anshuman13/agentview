import { live, peopleOf, type Meeting } from './wiki';

const HOUR = 3600_000;
const MAX_HOURS = 8;

export type LoadWeek = { start: number; hours: number; recorded: number; unrecorded: number };

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
    for (const p of new Set(peopleOf(m))) shared.set(p, (shared.get(p) ?? 0) + hours);
  }
  const people = [...shared].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, hours]) => ({ name, hours }));
  return { weeks: out, people };
}
