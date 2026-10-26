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

export type Reply ={ version: number; changes: PulledChange[]; hasMore?: boolean };

export const FIELDS = ['title', 'text', 'source', 'source_url', 'people', 'at', 'status', 'meeting_id'] as const;

// Synced data columns per table, the same as TABLES in assistant/src/db.ts.
export const TABLE_FIELDS: Record<string, readonly string[]> = {
  items: FIELDS,
  facts: ['text', 'item_id', 'superseded_by', 'page_id', 'heading', 'sources', 'at', 'contested', 'state', 'replaces', 'added_by'],
  pages: ['title', 'section', 'summary', 'sort', 'state'],
  meetings: ['title', 'starts_at', 'ends_at', 'people', 'calendar_url', 'recorded_ms', 'notes', 'summary', 'decisions'],
  actions: ['meeting_id', 'kind', 'target', 'title', 'body', 'fields', 'status', 'result_url'],
};

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
  meeting_id: string | null;
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

export type SyncRow = { id: string; profile: Profile; version: number; updated_at: number; deleted: number; field_times: string; dirty: number };
export type Merged<R extends SyncRow> = Omit<R, 'field_times'> & { field_times: FieldTimes };
export type MergedRow = Merged<ItemRow>;

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

export function rowToChange<R extends SyncRow>(row: R, table = 'items'): Change {
  const times = parseTimes(row.field_times);
  const values = row as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  const field_times: FieldTimes = {};
  for (const f of TABLE_FIELDS[table]) {
    if (isTime(times[f])) {
      fields[f] = values[f] ?? null;
      field_times[f] = times[f];
    }
  }
  const change: Change = { table, id: row.id, profile: row.profile, updated_at: row.updated_at, fields, field_times };
  if (isTime(times.deleted)) {
    // The hub times the deleted flag with updated_at.
    change.deleted = !!row.deleted;
    change.updated_at = times.deleted;
  }
  return change;
}

export function mergeIncoming<R extends SyncRow = ItemRow>(local: NoInfer<R> | null, incoming: PulledChange): Merged<R> {
  const inTimes = parseTimes(incoming.field_times);
  const localTimes = local ? parseTimes(local.field_times) : {};
  const values = (incoming.fields || {}) as Record<string, unknown>;
  const localValues = (local ?? {}) as Record<string, unknown>;
  const times: FieldTimes = { ...localTimes };
  const merged = { id: incoming.id, profile: incoming.profile, version: incoming.version } as Merged<R>;
  const mergedFields = merged as unknown as Record<string, unknown>;
  let localNewer = false;

  for (const f of TABLE_FIELDS[incoming.table] ?? FIELDS) {
    const it = inTimes[f] ?? (localTimes[f] ? 0 : incoming.updated_at);
    const lt = localTimes[f] ?? 0;
    if (!local || it > lt) {
      mergedFields[f] = values[f] ?? null;
      if (isTime(it)) times[f] = it;
    } else {
      mergedFields[f] = localValues[f] ?? null;
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
