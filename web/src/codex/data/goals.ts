import { weekStart } from './dates';
import { atTime } from './engine';
import { taskMin } from './plan';
import { madeAt, type ItemRow, type Profile } from './sync';

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

export const linkedTo = (items: ItemRow[], goal: ItemRow) =>
  items.filter((r) => !r.deleted && r.profile === goal.profile && r.goal === goal.id && (r.status === 'open' || r.status === 'done'));

export function goalProgress(items: ItemRow[], goal: ItemRow) {
  const tasks = linkedTo(items, goal);
  return { done: tasks.filter((r) => r.status === 'done').length, total: tasks.length };
}

// A goal is at risk when its open tasks' estimates, summed, exceed the free work minutes left this week.
export function goalAtRisk(items: ItemRow[], goal: ItemRow, freeMin: number) {
  const need = linkedTo(items, goal).filter((r) => r.status === 'open').reduce((n, r) => n + taskMin(r.title), 0);
  return need > freeMin;
}

// Last week's goals not fully done, for each profile that has none this week yet.
export function carryOver(items: ItemRow[], now: number, profile?: Profile): ItemRow[] {
  if (!profile) return (['work', 'personal'] as const).flatMap((p) => carryOver(items, now, p));
  if (goalsOf(items, now, profile).length) return [];
  const d = new Date(weekStart(now));
  const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7, 12).getTime();
  return goalsOf(items, prev, profile).filter((g) => {
    const p = goalProgress(items, g);
    return !p.total || p.done < p.total;
  });
}

export const goalVerdict = (p: { done: number; total: number }) => (p.total > 0 && p.done === p.total ? 'Done' : 'Missed');

export const GOAL_WEEKS = 8;

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

// The weekly review shows from Friday 14:00 local through Sunday.
export function reviewWindow(now: number) {
  const d = new Date(now);
  return d.getDay() === 6 || d.getDay() === 0 || (d.getDay() === 5 && d.getHours() >= 14);
}

export const titleKey = (t: string | null) => (t ?? '').trim().toLowerCase();

// Missed goals of this week that next week can still take: titles to create, how many the limit leaves out, and which control the card shows.
export function reviewCarry(items: ItemRow[], now: number, profile: Profile) {
  const d = new Date(weekStart(now));
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
  const nextGoals = goalsOf(items, next, profile);
  const have = new Set(nextGoals.map((g) => titleKey(g.title)));
  const seen = new Set<string>();
  const missed = goalsOf(items, now, profile).filter((g) => {
    const k = titleKey(g.title);
    if (!k || seen.has(k) || goalVerdict(goalProgress(items, g)) !== 'Missed') return false;
    seen.add(k);
    return true;
  });
  const room = Math.max(0, MAX_GOALS - nextGoals.length);
  const pending = missed.filter((g) => !have.has(titleKey(g.title)));
  const carried = missed.length - pending.length;
  const left = Math.max(0, pending.length - room);
  const state = pending.length > 0 && room > 0 ? 'carry' : carried > 0 ? 'carried' : pending.length > 0 ? 'full' : 'none';
  return { next, titles: pending.slice(0, room).map((g) => (g.title ?? '').trim()), left, carried, state } as const;
}

// Dismissal entries are profile:date; entries of other dates are dropped.
export const pruneDismissed = (entries: string[], today: string) => entries.filter((e) => e.endsWith(`:${today}`));
