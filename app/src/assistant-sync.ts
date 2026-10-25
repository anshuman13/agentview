import type { Change, PulledChange } from '../../assistant/src/sync';

export type { Change, PulledChange };

export const FIELDS = ['title', 'text', 'source', 'source_url', 'people', 'at', 'status'] as const;

export type Field = (typeof FIELDS)[number];
export type FieldTimes = Record<string, number>;
export type Profile = Change['profile'];

export type ItemFields = {
  title: string | null;
  text: string | null;
  source: string | null;
  source_url: string | null;
  people: string | null;
  at: number | string | null;
  status: string | null;
};

export type ItemRow = ItemFields & {
  id: string;
  profile: Profile;
  version: number;
  updated_at: number;
  deleted: number;
  field_times: string;
  dirty: number;
};

export type MergedRow = Omit<ItemRow, 'field_times'> & { field_times: FieldTimes };

type FieldValues = Record<Field, ItemFields[Field]>;

export function parseTimes(value: unknown): FieldTimes {
  if (!value) return {};
  if (typeof value === 'object') return value as FieldTimes;
  try {
    const parsed = JSON.parse(value as string);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const isTime = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t);

export function rowToChange(row: ItemRow): Change {
  const times = parseTimes(row.field_times);
  const fields: Record<string, unknown> = {};
  const field_times: FieldTimes = {};
  for (const f of FIELDS) {
    if (isTime(times[f])) {
      fields[f] = row[f] ?? null;
      field_times[f] = times[f];
    }
  }
  const change: Change = { table: 'items', id: row.id, profile: row.profile, updated_at: row.updated_at, fields, field_times };
  if (isTime(times.deleted)) {
    // The hub times the deleted flag with updated_at.
    change.deleted = !!row.deleted;
    change.updated_at = times.deleted;
  }
  return change;
}

export function mergeIncoming(local: ItemRow | null, incoming: PulledChange): MergedRow {
  const inTimes = parseTimes(incoming.field_times);
  const localTimes = local ? parseTimes(local.field_times) : {};
  const values = (incoming.fields || {}) as Partial<FieldValues>;
  const times: FieldTimes = { ...localTimes };
  const merged = { id: incoming.id, profile: incoming.profile, version: incoming.version } as MergedRow;
  const mergedFields: FieldValues = merged;
  let localNewer = false;

  for (const f of FIELDS) {
    const it = inTimes[f] ?? incoming.updated_at;
    const lt = localTimes[f] ?? 0;
    if (!local || it > lt) {
      mergedFields[f] = values[f] ?? null;
      if (isTime(it)) times[f] = it;
    } else {
      mergedFields[f] = local[f] ?? null;
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
