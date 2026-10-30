import { atTime } from './engine';
import { parseTimes, type ItemRow, type Profile } from './sync';

// A weekly goal is an item with status 'goal' whose at is a time in its week, stored as that week's Monday 00:00; a task links to one by its goal field.
export const GOAL = 'goal';
export const MAX_GOALS = 3;

export function weekStart(now: number) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}

const madeAt = (r: ItemRow) => parseTimes(r.field_times).source ?? r.updated_at;

export function goalsOf(items: ItemRow[], now: number, profile?: Profile) {
  const start = weekStart(now);
  const d = new Date(start);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
  const inWeek = (at: number | null) => at != null && at >= start && at < end;
  return items
    .filter((r) => !r.deleted && r.status === GOAL && inWeek(atTime(r.at)) && (!profile || r.profile === profile))
    .sort((a, b) => madeAt(a) - madeAt(b));
}

const linkedTo = (items: ItemRow[], goal: ItemRow) =>
  items.filter((r) => !r.deleted && r.profile === goal.profile && r.goal === goal.id && (r.status === 'open' || r.status === 'done'));

export function goalProgress(items: ItemRow[], goal: ItemRow) {
  const tasks = linkedTo(items, goal);
  return { done: tasks.filter((r) => r.status === 'done').length, total: tasks.length };
}
