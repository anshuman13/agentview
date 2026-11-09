import { atTime } from '../data/tasks/engine';
import type { ItemRow } from '../data/sync';

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
