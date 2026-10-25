import Database from 'better-sqlite3';
import { TABLES } from './db.js';

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

function getNextVersion(db: Database.Database): number {
  const metaStmt = db.prepare('UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = ?');
  metaStmt.run('version');
  const row = db.prepare('SELECT CAST(value AS INTEGER) as value FROM meta WHERE key = ?').get('version') as { value: number };
  return row.value;
}

export function applyChanges(
  db: Database.Database,
  changes: Change[]
): { version: number; applied: number } {
  // Validate all changes first
  for (const change of changes) {
    if (!(change.table in TABLES)) {
      throw new Error(`Invalid table: ${change.table}`);
    }
    if (typeof change.id !== 'string' || !change.id) {
      throw new Error(`Invalid id: must be non-empty string`);
    }
    if (change.profile !== 'work' && change.profile !== 'personal') {
      throw new Error(`Invalid profile: ${change.profile}`);
    }
    const validColumns = TABLES[change.table];
    for (const field of Object.keys(change.fields)) {
      if (!validColumns.includes(field)) {
        throw new Error(
          `Invalid field ${field} for table ${change.table}`
        );
      }
      const value = change.fields[field];
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
        throw new Error(
          `Invalid value type for ${field}: must be string, number, or null`
        );
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

      const changeDeletedTime = updated_at;
      const storedDeletedTime = storedFieldTimes['deleted'] ?? 0;
      const changeDeleted = deleted ?? false;

      let finalDeleted = storedDeleted;
      if (changeDeletedTime > storedDeletedTime) {
        finalDeleted = changeDeleted ? 1 : 0;
        newFieldTimes['deleted'] = changeDeletedTime;
        if ((changeDeleted ? 1 : 0) !== storedDeleted) {
          hasChanges = true;
        }
      }

      if (!hasChanges) {
        continue;
      }

      const newUpdatedAt = Math.max(storedUpdatedAt, updated_at);
      const newVersion = getNextVersion(db);

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
  db: Database.Database,
  since: number,
  limit = 1000
): { version: number; changes: PulledChange[] } {
  const changes: PulledChange[] = [];
  let maxVersion = since;

  for (const table of Object.keys(TABLES)) {
    if (changes.length >= limit) break;

    const dataColumns = TABLES[table];
    let sql = `SELECT id, profile, version, updated_at, deleted, field_times, `;
    sql += dataColumns.join(', ');
    sql += ` FROM ${table} WHERE version > ? ORDER BY version, id LIMIT ?`;

    const selectStmt = db.prepare(sql);
    const rows = selectStmt.all(since, limit - changes.length) as any[];

    for (const row of rows) {
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
      maxVersion = Math.max(maxVersion, row.version);
    }
  }

  return { version: maxVersion, changes };
}
