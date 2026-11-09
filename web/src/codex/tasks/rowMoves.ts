import type { Patch } from '../data/store';
import type { ItemRow } from '../data/sync';
import type { Drop } from '../gestures/drag';
import { moveTo } from './days';
import { showSnack } from '../view';
import { UNROLL, useActions } from './Task';
import type { Day } from './TaskGroup';

type Act = ReturnType<typeof useActions>;

const sameRow = (a: ItemRow, b: ItemRow) => a.profile === b.profile && a.id === b.id;

// Dropping sets the order of the day's rows and moves the task to that day.
export function dropRow(act: Act, days: Day[], startOfDay: number, row: ItemRow, d: Drop) {
  const target = days.find((x) => x.key === d.section);
  if (!target || target.day == null) return;
  const order = target.rows.filter((r) => !sameRow(r, row));
  order.splice(d.index, 0, row);
  const at = moveTo(row, target.day, startOfDay);
  order.forEach((r, i) => {
    const patch: Patch = r.rank === i + 1 ? {} : { rank: i + 1 };
    if (sameRow(r, row) && at !== undefined) Object.assign(patch, { at }, UNROLL);
    if (Object.keys(patch).length) act.edit(r, patch);
  });
  if (at !== undefined) showSnack(`Moved to ${target.label}`, () => act.edit(row, { at: row.at, rank: row.rank, rolls: row.rolls, rolled_from: row.rolled_from }));
}

// Overdue tasks move to today at the same time of day, with one undo for all of them.
export function moveOverdue(act: Act, overdue: ItemRow[], startOfDay: number) {
  const moved = overdue.map((r) => ({ r, before: { at: r.at, rolls: r.rolls, rolled_from: r.rolled_from } as Patch, at: moveTo(r, startOfDay, startOfDay) }));
  for (const m of moved) if (m.at !== undefined) act.edit(m.r, { at: m.at, ...UNROLL });
  showSnack(`Moved ${moved.length} to Today`, () => moved.forEach((m) => act.edit(m.r, m.before)));
}
