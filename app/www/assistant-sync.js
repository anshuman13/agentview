export const FIELDS = ['title', 'text', 'source', 'source_url', 'people', 'at', 'status'];

export function rowToChange(row) {
  const fieldTimes = typeof row.field_times === 'string' ? JSON.parse(row.field_times) : row.field_times;
  const fields = {};
  for (const f of FIELDS) {
    fields[f] = row[f] ?? null;
  }
  const changes = { ...fieldTimes };
  if (row.deleted) {
    changes.deleted = row.deleted === true ? Date.now() : row.deleted;
  }
  return {
    table: 'items',
    id: row.id,
    profile: row.profile,
    deleted: !!row.deleted,
    updated_at: row.updated_at,
    fields,
    field_times: changes,
  };
}

export function mergeIncoming(local, incoming) {
  const incomingFieldTimes = typeof incoming.field_times === 'string' ? JSON.parse(incoming.field_times) : incoming.field_times;
  const localFieldTimes = local && (typeof local.field_times === 'string' ? JSON.parse(local.field_times) : local.field_times) || {};

  let dirty = 0;
  const merged = {
    id: incoming.id,
    profile: incoming.profile,
    version: incoming.version,
    deleted: 0,
    updated_at: incoming.updated_at,
    field_times: {},
    dirty: 0,
  };

  for (const f of FIELDS) {
    const incomingTime = incomingFieldTimes[f] ?? incoming.updated_at;
    const localTime = localFieldTimes[f] ?? 0;

    if (incomingTime > localTime) {
      merged[f] = incoming[f] ?? null;
      merged.field_times[f] = incomingTime;
    } else {
      merged[f] = local ? (local[f] ?? null) : null;
      merged.field_times[f] = Math.max(incomingTime, localTime);
      if (incomingTime < localTime) {
        dirty = 1;
      }
    }
  }

  const incomingDeletedTime = incomingFieldTimes.deleted ?? incoming.updated_at;
  const localDeletedTime = localFieldTimes.deleted ?? (local ? 0 : 0);

  if (incomingDeletedTime > localDeletedTime) {
    merged.deleted = incoming.deleted ? incomingDeletedTime : 0;
    if (incoming.deleted) {
      merged.field_times.deleted = incomingDeletedTime;
    }
  } else {
    merged.deleted = local && local.deleted ? localDeletedTime : 0;
    if (local && local.deleted) {
      merged.field_times.deleted = localDeletedTime;
    }
    if (localDeletedTime > 0 && incomingDeletedTime < localDeletedTime) {
      dirty = 1;
    }
  }

  if (dirty) {
    merged.dirty = 1;
  }

  return merged;
}
