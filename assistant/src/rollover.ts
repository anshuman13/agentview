import type { Database } from 'bun:sqlite';
import type { Profile } from './db.js';
import { applyChanges } from './sync.js';

const STALE = 3;

// Open tasks from an earlier day move to today at the same time. Moves on weekdays count toward STALE; after STALE a task goes back to review.
export function rollOver(db: Database, now = Date.now()) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const weekday = new Date(now).getDay() % 6 !== 0;
  const rows = db.prepare("SELECT id, profile, at, rolls, rolled_from, field_times FROM items WHERE deleted = 0 AND status = 'open' AND COALESCE(source, '') != 'calendar' AND at IS NOT NULL AND CAST(at AS INTEGER) < ?").all(today) as { id: string; profile: Profile; at: number | string; rolls: number | null; rolled_from: number | null; field_times: string | null }[];
  // A due time that is not a number, like '', counts as none.
  const due = rows.filter((r) => String(r.at).trim() !== '' && Number.isFinite(Number(r.at)));
  return applyChanges(db, due.map((r) => {
    const from = new Date(Number(r.at));
    const at = new Date(now).setHours(from.getHours(), from.getMinutes(), 0, 0);
    const rolls = (r.rolls ?? 0) + (weekday ? 1 : 0);
    const stored = JSON.parse(r.field_times ?? '{}') as Record<string, number>;
    const after = { ...Object.fromEntries(['at', 'rolls', 'rolled_from'].map((f) => [f, (stored[f] ?? 0) + 1])), ...(rolls >= STALE && { status: now }) };
    return { table: 'items', id: r.id, profile: r.profile, updated_at: now, field_times: after, fields: { at, rolls, rolled_from: r.rolled_from ?? Number(r.at), ...(rolls >= STALE && { status: 'suggested' }) } };
  })).applied;
}
