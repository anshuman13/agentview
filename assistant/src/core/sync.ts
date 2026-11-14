import { Database } from 'bun:sqlite';
import { TABLES, currentVersion, isProfile, nextVersion, stmt, type Profile } from './db.js';
import { mergeDismissed } from '../../../shared/dismissed.js';

export class SyncError extends Error {}

export type Change = {
  table: string;
  id: string;
  profile: Profile;
  deleted?: boolean;
  updated_at: number;
  fields: Record<string, unknown>;
  field_times?: Record<string, number>;
};

export type PulledChange = Change & {
  version: number;
  deleted: boolean;
  field_times: Record<string, number>;
};

type PullResult = {
  version: number;
  changes: PulledChange[];
  hasMore: boolean;
};

function invalid(change: Change): string | null {
  try {
    check(change);
    return null;
  } catch (err) {
    if (err instanceof SyncError) return err.message;
    throw err;
  }
}

function check(change: Change) {
  if (!change || typeof change !== 'object') throw new SyncError('Invalid change');
  if (!Object.hasOwn(TABLES, change.table)) {
    throw new SyncError(`Invalid table: ${change.table}`);
  }
  if (typeof change.id !== 'string' || !change.id) {
    throw new SyncError(`Invalid id: must be non-empty string`);
  }
  if (!isProfile(change.profile)) {
    throw new SyncError(`Invalid profile: ${change.profile}`);
  }
  if (typeof change.updated_at !== 'number' || !Number.isFinite(change.updated_at)) {
    throw new SyncError(`Invalid updated_at: must be a finite number`);
  }
  if (!change.fields || typeof change.fields !== 'object' || Array.isArray(change.fields)) {
    throw new SyncError('Invalid fields: must be an object');
  }
  const validColumns = TABLES[change.table];
  for (const field of Object.keys(change.fields)) {
    if (!validColumns.includes(field)) {
      throw new SyncError(
        `Invalid field ${field} for table ${change.table}`
      );
    }
    const value = change.fields[field];
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
      throw new SyncError(
        `Invalid value type for ${field}: must be string, number, or null`
      );
    }
  }
  if (change.field_times) {
    for (const [field, time] of Object.entries(change.field_times)) {
      if (typeof time !== 'number' || !Number.isFinite(time)) {
        throw new SyncError(`Invalid field_times.${field}: must be a finite number`);
      }
    }
  }
}

export type Rejected = { table: string; id: string; reason: string };

export function applyChanges(
  db: Database,
  changes: Change[]
): { version: number; applied: number } {
  for (const change of changes) check(change);
  return write(db, changes);
}

// Applies the valid changes and returns the invalid ones, so one bad change does not block the batch.
function applyValid(db: Database, changes: Change[]): { version: number; applied: number; rejected: Rejected[] } {
  const good: Change[] = [];
  const rejected: Rejected[] = [];
  for (const change of changes) {
    const reason = invalid(change);
    if (reason === null) good.push(change);
    else rejected.push({ table: String(change?.table), id: String(change?.id), reason });
  }
  return { ...write(db, good), rejected };
}

type StoredRow = { version: number; updated_at: number; field_times: string | null; deleted: number };

type Merge = {
  valuesToSet: Record<string, unknown>;
  fieldTimes: Record<string, number>;
  deleted: number;
  hasChanges: boolean;
};

function mergeChange(change: Change, row: StoredRow | null): Merge {
  const { deleted, updated_at, fields, field_times } = change;
  const storedFieldTimes: Record<string, number> = row?.field_times ? JSON.parse(row.field_times) : {};
  const merge: Merge = { valuesToSet: {}, fieldTimes: { ...storedFieldTimes }, deleted: row?.deleted ?? 0, hasChanges: false };

  for (const [field, value] of Object.entries(fields)) {
    const changeFieldTime = field_times?.[field] ?? updated_at;
    if (changeFieldTime > (storedFieldTimes[field] ?? 0)) {
      merge.valuesToSet[field] = value;
      merge.fieldTimes[field] = changeFieldTime;
      merge.hasChanges = true;
    }
  }

  if (deleted !== undefined && updated_at > (storedFieldTimes['deleted'] ?? 0)) {
    merge.deleted = deleted ? 1 : 0;
    merge.fieldTimes['deleted'] = updated_at;
    merge.hasChanges = true;
  }
  return merge;
}

function insertRow(db: Database, change: Change, merge: Merge, version: number, updatedAt: number) {
  const allColumns = ['id', 'profile', 'version', 'updated_at', 'deleted', 'field_times', ...Object.keys(merge.valuesToSet)];
  const vals = [change.id, change.profile, version, updatedAt, merge.deleted, JSON.stringify(merge.fieldTimes), ...Object.values(merge.valuesToSet)];
  const sql = `INSERT INTO ${change.table} (${allColumns.join(', ')}) VALUES (${allColumns.map(() => '?').join(', ')})`;
  stmt(db, sql).run(...(vals as any[]));
}

function updateRow(db: Database, change: Change, merge: Merge, version: number, updatedAt: number) {
  const setClauses = ['version = ?', 'updated_at = ?', 'deleted = ?', 'field_times = ?'];
  const vals: any[] = [version, updatedAt, merge.deleted, JSON.stringify(merge.fieldTimes)];
  for (const [field, value] of Object.entries(merge.valuesToSet)) {
    setClauses.push(`${field} = ?`);
    vals.push(value);
  }
  vals.push(change.id, change.profile);
  stmt(db, `UPDATE ${change.table} SET ${setClauses.join(', ')} WHERE id = ? AND profile = ?`).run(...vals);
}

// A brief's dismissed lines merge as a set, so a device's dismissal is never replaced by another's older list.
function withMergedDismissed(db: Database, change: Change, row: StoredRow | null): Change {
  if (change.table !== 'briefs' || !row || !('dismissed' in change.fields)) return change;
  const stored = (stmt(db, 'SELECT dismissed FROM briefs WHERE id = ? AND profile = ?').get(change.id, change.profile) as { dismissed: string | null }).dismissed;
  const merged = mergeDismissed(stored, change.fields.dismissed as string | null);
  const { dismissed: _, ...rest } = change.fields;
  if (merged === stored) return { ...change, fields: rest };
  const storedAt = (row.field_times ? JSON.parse(row.field_times) : {}).dismissed ?? 0;
  const at = Math.max(change.field_times?.dismissed ?? change.updated_at, storedAt + 1);
  return { ...change, fields: { ...rest, dismissed: merged }, field_times: { ...change.field_times, dismissed: at } };
}

// Returns the new row version, or null when every field of the change is older than what is stored.
function applyChange(db: Database, change: Change): number | null {
  const row = stmt(db, `SELECT version, updated_at, field_times, deleted FROM ${change.table} WHERE id = ? AND profile = ?`)
    .get(change.id, change.profile) as StoredRow | null;
  const merge = mergeChange(withMergedDismissed(db, change, row), row);
  if (!merge.hasChanges) return null;

  const version = nextVersion(db);
  const updatedAt = Math.max(row?.updated_at ?? 0, change.updated_at);
  if (row) updateRow(db, change, merge, version, updatedAt);
  else insertRow(db, change, merge, version, updatedAt);
  return version;
}

function write(
  db: Database,
  changes: Change[]
): { version: number; applied: number } {
  let maxVersion = 0;
  let applied = 0;

  const txn = db.transaction(() => {
    for (const change of changes) {
      const version = applyChange(db, change);
      if (version === null) continue;
      maxVersion = Math.max(maxVersion, version);
      applied++;
    }
  });

  txn();

  return { version: maxVersion, applied };
}


// Pushes and pulls in one step. The since check runs before the push, which would otherwise raise the hub version past it.
export function exchange(db: Database, since: number, changes: Change[]): PullResult & { rejected: Rejected[] } {
  if (since > currentVersion(db)) since = 0;
  const { rejected } = applyValid(db, changes);
  return { ...pullChanges(db, since), rejected };
}

function pulledChange(table: string, row: any): PulledChange {
  const fields: Record<string, unknown> = {};
  for (const col of TABLES[table]) fields[col] = row[col];
  return {
    table,
    id: row.id,
    profile: row.profile,
    deleted: row.deleted === 1,
    updated_at: row.updated_at,
    version: row.version,
    fields,
    field_times: JSON.parse(row.field_times),
  };
}

export function pullChanges(
  db: Database,
  since: number,
  limit = 1000
): PullResult {
  // A device ahead of the hub, as after a restore from backup, would never see the rows written since, so it gets them all.
  const head = currentVersion(db);
  if (since > head) since = 0;
  // Most polls find nothing new, so they skip the table queries.
  if (since === head) return { version: since, changes: [], hasMore: false };
  const allRows: Array<{ table: string; row: any }> = [];

  for (const table of Object.keys(TABLES)) {
    const dataColumns = TABLES[table];
    let sql = `SELECT id, profile, version, updated_at, deleted, field_times, `;
    sql += dataColumns.join(', ');
    sql += ` FROM ${table} WHERE version > ? ORDER BY version, id LIMIT ?`;

    const selectStmt = stmt(db, sql);
    const rows = selectStmt.all(since, limit + 1) as any[];

    for (const row of rows) {
      allRows.push({ table, row });
    }
  }

  allRows.sort((a, b) => {
    const versionDiff = a.row.version - b.row.version;
    if (versionDiff !== 0) return versionDiff;
    return a.row.id.localeCompare(b.row.id);
  });

  const hasMore = allRows.length > limit;
  const changes: PulledChange[] = [];
  let maxVersion = since;

  for (const { table, row } of allRows.slice(0, limit)) {
    changes.push(pulledChange(table, row));
    maxVersion = row.version;
  }

  return { version: maxVersion, changes, hasMore };
}
