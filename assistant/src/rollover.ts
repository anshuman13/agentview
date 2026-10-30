import type { Database } from 'bun:sqlite';
import type { Profile } from './db.js';
import { applyChanges } from './sync.js';

export const STALE = 3;

// Open tasks from an earlier day move to today at the same time. After STALE moves a task goes back to review.
export function rollOver(db: Database, now = Date.now()) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const rows = db.prepare("SELECT id, profile, at, rolls, rolled_from FROM items WHERE deleted = 0 AND status = 'open' AND COALESCE(source, '') != 'calendar' AND at IS NOT NULL AND CAST(at AS INTEGER) < ?").all(today) as { id: string; profile: Profile; at: number | string; rolls: number | null; rolled_from: number | null }[];
  return applyChanges(db, rows.map((r) => {
    const from = new Date(Number(r.at));
    const at = new Date(now).setHours(from.getHours(), from.getMinutes(), 0, 0);
    const rolls = (r.rolls ?? 0) + 1;
    return { table: 'items', id: r.id, profile: r.profile, updated_at: now, fields: { at, rolls, rolled_from: r.rolled_from ?? Number(r.at), ...(rolls >= STALE && { status: 'suggested' }) } };
  })).applied;
}
