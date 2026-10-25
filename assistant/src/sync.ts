import { Database } from 'bun:sqlite';
import { TABLES, nextVersion } from './db.js';

export class SyncError extends Error {}

export type Change = {
  table: string;
  id: string;
  profile: 'work' | 'personal';
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

export type PullResult = {
  version: number;
  changes: PulledChange[];
  hasMore: boolean;
};

export function applyChanges(
  db: Database,
  changes: Change[]
): { version: number; applied: number } {
  // Validate all changes first
  for (const change of changes) {
    if (!Object.hasOwn(TABLES, change.table)) {
      throw new SyncError(`Invalid table: ${change.table}`);
    }
    if (typeof change.id !== 'string' || !change.id) {
      throw new SyncError(`Invalid id: must be non-empty string`);
    }
    if (change.profile !== 'work' && change.profile !== 'personal') {
      throw new SyncError(`Invalid profile: ${change.profile}`);
    }
    if (typeof change.updated_at !== 'number' || !Number.isFinite(change.updated_at)) {
      throw new SyncError(`Invalid updated_at: must be a finite number`);
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

  let maxVersion = 0;
  let applied = 0;

  const txn = db.transaction(() => {
    for (const change of changes) {
      const { table, id, profile, deleted, updated_at, fields, field_times } = change;

      const selectStmt = db.prepare(
        `SELECT version, updated_at, field_times, deleted FROM ${table} WHERE id = ? AND profile = ?`
      );
      const row = selectStmt.get(id, profile) as any;

      const storedUpdatedAt = row?.updated_at ?? 0;
      const storedFieldTimes: Record<string, number> = row?.field_times ? JSON.parse(row.field_times) : {};
      const storedDeleted = row?.deleted ?? 0;

      const newFieldTimes: Record<string, number> = { ...storedFieldTimes };
      const valuesToSet: Record<string, unknown> = {};
      let hasChanges = false;

      for (const [field, value] of Object.entries(fields)) {
        const changeFieldTime = field_times?.[field] ?? updated_at;
        const storedFieldTime = storedFieldTimes[field] ?? 0;

        if (changeFieldTime > storedFieldTime) {
          valuesToSet[field] = value;
          newFieldTimes[field] = changeFieldTime;
          hasChanges = true;
        }
      }

      let finalDeleted = storedDeleted;
      if (deleted !== undefined) {
        const changeDeletedTime = updated_at;
        const storedDeletedTime = storedFieldTimes['deleted'] ?? 0;

        if (changeDeletedTime > storedDeletedTime) {
          finalDeleted = deleted ? 1 : 0;
          newFieldTimes['deleted'] = changeDeletedTime;
          if ((deleted ? 1 : 0) !== storedDeleted) {
            hasChanges = true;
          }
        }
      }

      if (!hasChanges) {
        continue;
      }

      const newUpdatedAt = Math.max(storedUpdatedAt, updated_at);
      const newVersion = nextVersion(db);

      if (!row) {
        const dataColumns = Object.keys(valuesToSet);
        const allColumns = ['id', 'profile', 'version', 'updated_at', 'deleted', 'field_times', ...dataColumns];
        const vals = [id, profile, newVersion, newUpdatedAt, finalDeleted, JSON.stringify(newFieldTimes), ...Object.values(valuesToSet)];

        let sql = `INSERT INTO ${table} (`;
        sql += allColumns.join(', ');
        sql += `) VALUES (${allColumns.map(() => '?').join(', ')})`;

        const insertStmt = db.prepare(sql);
        insertStmt.run(...vals);
      } else {
        const setClauses = [];
        const vals: any[] = [];

        setClauses.push('version = ?');
        vals.push(newVersion);
        setClauses.push('updated_at = ?');
        vals.push(newUpdatedAt);
        setClauses.push('deleted = ?');
        vals.push(finalDeleted);
        setClauses.push('field_times = ?');
        vals.push(JSON.stringify(newFieldTimes));

        for (const [field, value] of Object.entries(valuesToSet)) {
          setClauses.push(`${field} = ?`);
          vals.push(value);
        }

        vals.push(id);
        vals.push(profile);

        let sql = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ? AND profile = ?`;
        const updateStmt = db.prepare(sql);
        updateStmt.run(...vals);
      }

      maxVersion = Math.max(maxVersion, newVersion);
      applied++;
    }
  });

  txn();

  return { version: maxVersion, applied };
}

export function pullChanges(
  db: Database,
  since: number,
  limit = 1000
): PullResult {
  const allRows: Array<{ table: string; row: any }> = [];

  for (const table of Object.keys(TABLES)) {
    const dataColumns = TABLES[table];
    let sql = `SELECT id, profile, version, updated_at, deleted, field_times, `;
    sql += dataColumns.join(', ');
    sql += ` FROM ${table} WHERE version > ? ORDER BY version, id LIMIT ?`;

    const selectStmt = db.prepare(sql);
    const rows = selectStmt.all(since, limit) as any[];

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

  for (let i = 0; i < Math.min(limit, allRows.length); i++) {
    const { table, row } = allRows[i];
    const dataColumns = TABLES[table];
    const fieldTimes = JSON.parse(row.field_times);
    const fields: Record<string, unknown> = {};

    for (const col of dataColumns) {
      fields[col] = row[col];
    }

    const change: PulledChange = {
      table,
      id: row.id,
      profile: row.profile,
      deleted: row.deleted === 1,
      updated_at: row.updated_at,
      version: row.version,
      fields,
      field_times: fieldTimes,
    };

    changes.push(change);
    maxVersion = row.version;
  }

  return { version: maxVersion, changes, hasMore };
}
