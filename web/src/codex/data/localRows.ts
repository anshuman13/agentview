import { TABLE_FIELDS } from './sync';
import type { ItemRow, SyncRow } from './sync';
import type { Patch } from './store';

export type SqlValue = string | number | null;

export const PATCHABLE = ['title', 'text', 'status', 'at', 'rolls', 'rolled_from', 'rank', 'source', 'people', 'meeting_id', 'spent', 'goal', 'deleted'] as const;
export const DONE_KEEP_MS = 60 * 86400_000;

// SQL that writes row only if local is unchanged since it was read; it changes nothing when another write came first.
export const swapSQL = (name: string, row: SyncRow, local: SyncRow | undefined) => {
  const cols = ['version', 'updated_at', 'deleted', 'field_times', ...TABLE_FIELDS[name], 'dirty'];
  const r = row as unknown as Record<string, SqlValue>;
  const values = cols.map((c) => r[c] ?? null);
  return local
    ? {
      sql: `UPDATE ${name} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE profile = ? AND id = ? AND updated_at = ? AND field_times = ?`,
      params: [...values, row.profile, row.id, local.updated_at, local.field_times],
    }
    : {
      sql: `INSERT OR IGNORE INTO ${name} (${cols.join(', ')}, profile, id) VALUES (${Array(cols.length + 2).fill('?').join(', ')})`,
      params: [...values, row.profile, row.id],
    };
};

export const captureParams = (r: ItemRow): SqlValue[] =>
  [r.id, r.profile, r.updated_at, r.field_times, r.title, r.text, r.source, r.people, r.at, r.status, r.meeting_id];

export function patchSQL(patch: Patch) {
  const keys = PATCHABLE.filter((k) => k in patch);
  if (!keys.length) return null;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const times = keys.map((k) => `'$.${k}', max(?, IFNULL(json_extract(field_times, '$.${k}'), 0) + 1)`).join(', ');
  return { sql: `${sets}, field_times = json_set(field_times, ${times})`, params: (now: number): SqlValue[] => [...keys.map((k) => patch[k] ?? null), ...keys.map(() => now)] };
}

export const doneCutoff = (now: number) => now - DONE_KEEP_MS;
