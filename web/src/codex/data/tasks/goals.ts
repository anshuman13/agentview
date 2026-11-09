import { weekStart } from '../dates';
import { atTime } from './engine';
import { taskMin } from './plan';
import { madeAt, type ItemRow, type Profile } from '../sync';

// A weekly goal is an item with status 'goal' whose at is a time in its week, stored as that week's Monday 00:00; a task links to one by its goal field.
export const GOAL = 'goal';
export const MAX_GOALS = 3;

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

// A goal's tasks, open ones first then done, and its done/total count (undefined when it has no tasks).
export function goalSummary(items: ItemRow[], goal: ItemRow) {
  const tasks = linkedTo(items, goal);
  const open = tasks.filter((r) => r.status === 'open');
  const done = tasks.length - open.length;
  return { tasks: [...open, ...tasks.filter((r) => r.status === 'done')], count: tasks.length ? `${done}/${tasks.length}` : undefined };
}

// A goal is at risk when its open tasks' estimates, summed, exceed the free work minutes left this week.
export function goalAtRisk(items: ItemRow[], goal: ItemRow, freeMin: number) {
  const need = linkedTo(items, goal).filter((r) => r.status === 'open').reduce((n, r) => n + taskMin(r.title), 0);
  return need > freeMin;
}

const GOAL_WEEKS = 8;

// Goals of next week, this week and the 7 before it, newest week first; weeks without goals are left out.
export function goalHistory(items: ItemRow[], now: number, profile?: Profile) {
  const d = new Date(weekStart(now));
  const out: { start: number; label: string; goals: ItemRow[] }[] = [];
  for (let i = -1; i < GOAL_WEEKS; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * i, 12);
    const goals = goalsOf(items, day.getTime(), profile);
    if (!goals.length) continue;
    const start = weekStart(day.getTime());
    out.push({ start, goals, label: i < 0 ? 'Next week' : i === 0 ? 'This week' : i === 1 ? 'Last week' : `${day.toLocaleDateString('en-GB', { weekday: 'short' })} ${day.getDate()} ${day.toLocaleDateString('en-GB', { month: 'short' })}` });
  }
  return out;
}

// Why a goal cannot be reopened in this week, if it cannot.
export function reopenBlock(items: ItemRow[], goal: ItemRow, now: number) {
  const mine = goalsOf(items, now, goal.profile);
  if (mine.length >= MAX_GOALS) return 'full';
  return mine.some((g) => titleKey(g.title) === titleKey(goal.title)) ? 'same' : null;
}

// Why a goal of this week cannot move to next week, if it cannot.
export function moveBlock(items: ItemRow[], goal: ItemRow, now: number) {
  const d = new Date(weekStart(now));
  const mine = goalsOf(items, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime(), goal.profile);
  if (mine.length >= MAX_GOALS) return 'full';
  return mine.some((g) => titleKey(g.title) === titleKey(goal.title)) ? 'same' : null;
}

export const titleKey = (t: string | null) => (t ?? '').trim().toLowerCase();
