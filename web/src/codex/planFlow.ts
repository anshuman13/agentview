import { rowKey, type ItemRow } from './data/sync';
import { atTime } from './data/engine';
import { blockId } from '../../../shared/util';
import { packDay, type Span } from './data/plan';

export type Planned = { task: ItemRow; span: Span };

// The tasks without a block among blocks (meeting rows), only those in keep when given, packed into gaps in due then list order.
export function packUnblocked(tasks: ItemRow[], blocks: { profile: string; id: string }[], gaps: Span[], keep?: Set<string>): Planned[] {
  const blocked = new Set(blocks.map(rowKey));
  return packDay(tasks.filter((r) => !blocked.has(`${r.profile}:${blockId(r.id)}`) && (!keep || keep.has(rowKey(r)))).map((r) => ({ title: r.title, due: atTime(r.at), r })), gaps).map((p) => ({ task: p.task.r, span: p.span }));
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
