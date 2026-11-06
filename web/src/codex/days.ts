import { atTime } from './data/engine';
import type { ItemRow } from './data/sync';

export function greeting(h = new Date().getHours()) {
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// "Tomorrow", else the short weekday and date.
export function dayLabel(at: number, now = Date.now()) {
  const d = new Date(at);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

// The time on the new day keeps the time of day; a task with no time stays untimed today and gets 09:00 on another day.
// undefined means the task is already on that day.
export function moveTo(r: Pick<ItemRow, 'at'>, day: number, today: number) {
  const at = atTime(r.at);
  if (at != null && new Date(at).setHours(0, 0, 0, 0) === day) return undefined;
  if (at == null) return day === today ? undefined : new Date(day).setHours(9, 0, 0, 0);
  const t = new Date(at);
  return new Date(day).setHours(t.getHours(), t.getMinutes(), 0, 0);
}

export const HEAVY_MEETINGS = 3;
export const HEAVY_HOURS = 4;

// True when the day has 3 or more meetings or 4 or more hours of them; a meeting with no end counts no hours. Meetings are already filtered by profile and focus blocks.
export function heavyDay(meetings: { starts_at: number | null; ends_at: number | null }[], day: number) {
  const end = new Date(day).setHours(24, 0, 0, 0);
  const on = meetings.filter((m) => m.starts_at != null && m.starts_at >= day && m.starts_at < end);
  const ms = on.reduce((n, m) => n + (m.ends_at != null ? Math.max(0, m.ends_at - m.starts_at!) : 0), 0);
  return on.length >= HEAVY_MEETINGS || ms >= HEAVY_HOURS * 3600000;
}
