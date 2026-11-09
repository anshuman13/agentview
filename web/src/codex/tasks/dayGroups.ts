import { atTime } from '../data/tasks/engine';
import type { ItemRow } from '../data/sync';
import { dayLabel } from './days';
import { useSplit } from './split';
import type { Day } from './TaskGroup';

const UPCOMING_DAYS = 7;

// Rows keep the order they were dragged into; the rest follow by due time.
const ranked = (rs: ItemRow[]) => [...rs].sort((a, b) => (a.rank ?? 1e15) - (b.rank ?? 1e15) || (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0));
// A day's tasks sort by part of the day; tasks without a time come first.
const partOf = (r: ItemRow) => { const at = atTime(r.at); if (at == null) return 0; const h = new Date(at).getHours(); return h < 12 ? 1 : h < 17 ? 2 : 3; };

// Today holds everything due before midnight; later tasks follow by day, so a dated action never leaves the page.
export function dayGroups(s: ReturnType<typeof useSplit>, now: number, dragging: boolean) {
  const horizon = new Date(now).setHours(24 * (UPCOMING_DAYS + 1), 0, 0, 0);
  const dueToday = [...s.today, ...s.later.filter((r) => atTime(r.at)! < s.endOfDay)];
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const days: Day[] = [{ key: 'today', label: 'Today', day: startOfDay, rows: ranked(dueToday) }];
  for (const r of s.later.filter((r) => atTime(r.at)! >= s.endOfDay)) {
    const at = atTime(r.at)!;
    const later = at >= horizon;
    const day = later ? null : new Date(at).setHours(0, 0, 0, 0);
    const key = later ? 'later' : String(day);
    const g = days.find((d) => d.key === key);
    if (g) g.rows.push(r);
    else days.push({ key, label: later ? 'Later' : dayLabel(at), day, rows: [r] });
  }
  for (const d of days) d.rows = d.day == null ? ranked(d.rows) : ranked(d.rows).sort((a, b) => partOf(a) - partOf(b));
  const tomorrow = new Date(now).setHours(24, 0, 0, 0);
  if (dragging && !days.some((d) => d.day === tomorrow)) days.splice(1, 0, { key: String(tomorrow), label: 'Tomorrow', day: tomorrow, rows: [] });
  return { days, dueToday, startOfDay };
}
