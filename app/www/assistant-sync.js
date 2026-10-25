export const FIELDS = ['title', 'text', 'source', 'source_url', 'people', 'at', 'status'];

export function parseTimes(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const isTime = (t) => typeof t === 'number' && Number.isFinite(t);

export function rowToChange(row) {
  const times = parseTimes(row.field_times);
  const fields = {};
  const field_times = {};
  for (const f of FIELDS) {
    if (isTime(times[f])) {
      fields[f] = row[f] ?? null;
      field_times[f] = times[f];
    }
  }
  const change = { table: 'items', id: row.id, profile: row.profile, updated_at: row.updated_at, fields, field_times };
  if (isTime(times.deleted)) {
    // The hub times the deleted flag with updated_at.
    change.deleted = !!row.deleted;
    change.updated_at = times.deleted;
  }
  return change;
}

export function mergeIncoming(local, incoming) {
  const inTimes = parseTimes(incoming.field_times);
  const localTimes = local ? parseTimes(local.field_times) : {};
  const values = incoming.fields || {};
  const times = { ...localTimes };
  const merged = { id: incoming.id, profile: incoming.profile, version: incoming.version };
  let localNewer = false;

  for (const f of FIELDS) {
    const it = inTimes[f] ?? incoming.updated_at;
    const lt = localTimes[f] ?? 0;
    if (!local || it > lt) {
      merged[f] = values[f] ?? null;
      if (isTime(it)) times[f] = it;
    } else {
      merged[f] = local[f] ?? null;
      if (lt > it) localNewer = true;
    }
  }

  const idt = inTimes.deleted ?? 0;
  const ldt = localTimes.deleted ?? 0;
  if (!local || idt > ldt) {
    merged.deleted = incoming.deleted ? 1 : 0;
    if (idt) times.deleted = idt;
  } else {
    merged.deleted = local.deleted ? 1 : 0;
    if (ldt > idt) localNewer = true;
  }

  merged.field_times = times;
  merged.updated_at = Math.max(local?.updated_at ?? 0, incoming.updated_at ?? 0);
  merged.dirty = local?.dirty || localNewer ? 1 : 0;
  return merged;
}
