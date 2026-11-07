import { rowKey, type ItemRow } from './data/sync';
import { atTime } from './data/engine';
import { blockId } from '../../../shared/util';
import { packDay, type Span } from './data/plan';

export type Planned = { task: ItemRow; span: Span };
export type Skipped = { task: ItemRow; reason: string };

const NOW_WINDOW = 60 * 60_000;

// The tasks without a block among blocks (meeting rows).
export const unblocked = (tasks: ItemRow[], blocks: { profile: string; id: string }[]) => {
  const blocked = new Set(blocks.map(rowKey));
  return tasks.filter((r) => !blocked.has(`${r.profile}:${blockId(r.id)}`));
};

// The plan in time order, split into blocks that start within an hour of now (or already have) and the rest; tomorrow has no Now.
export function splitPlan(plan: Planned[], now: number, day: 'today' | 'tomorrow') {
  const sorted = [...plan].sort((a, b) => a.span[0] - b.span[0]);
  const soon = (p: Planned) => day === 'today' && p.span[0] <= now + NOW_WINDOW;
  return { now: sorted.filter(soon), later: sorted.filter((p) => !soon(p)) };
}

// The candidates the plan does not hold, why each is out: left out by the user, or no room in the day.
export function skippedOf(plan: Planned[], candidates: ItemRow[], leftOut: Set<string>, day: 'today' | 'tomorrow'): Skipped[] {
  const planned = new Set(plan.map((p) => rowKey(p.task)));
  return candidates.filter((r) => !planned.has(rowKey(r))).map((task) => ({ task, reason: leftOut.has(rowKey(task)) ? 'Left out' : `No room ${day}` }));
}

// The tasks without a block among blocks (meeting rows), only those in keep when given, packed into gaps in due then list order.
export function packUnblocked(tasks: ItemRow[], blocks: { profile: string; id: string }[], gaps: Span[], keep?: Set<string>): Planned[] {
  return packDay(unblocked(tasks, blocks).filter((r) => !keep || keep.has(rowKey(r))).map((r) => ({ title: r.title, due: atTime(r.at), r })), gaps).map((p) => ({ task: p.task.r, span: p.span }));
}

export type PlanResult =
  | { kind: 'changed'; plan: Planned[] }
  | { kind: 'created'; made: number }
  | { kind: 'failed'; made: number; left: Planned[]; error: unknown };

// Packs the plan again first and returns the new plan when it differs; otherwise blocks one task at a time and stops at the first failure.
export async function createPlanned(plan: Planned[], pack: (keep: Set<string>) => Planned[], block: (p: Planned) => Promise<void>): Promise<PlanResult> {
  const fresh = pack(new Set(plan.map((p) => rowKey(p.task))));
  const same = fresh.length === plan.length && fresh.every((p, i) => rowKey(p.task) === rowKey(plan[i].task) && p.span[0] === plan[i].span[0] && p.span[1] === plan[i].span[1]);
  if (!same) return { kind: 'changed', plan: fresh };
  let made = 0;
  try {
    for (const p of plan) {
      await block(p);
      made++;
    }
    return { kind: 'created', made };
  } catch (error) {
    return { kind: 'failed', made, left: plan.slice(made), error };
  }
}
