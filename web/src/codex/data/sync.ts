import { TABLES } from '../../../../shared/tables';

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

export type Paused = { scan: string; reason: string; until: number };
export type Reply ={ version: number; changes: PulledChange[]; hasMore?: boolean; paused?: Paused[] };

export const FIELDS = TABLES.items as (keyof ItemFields)[];

// Synced data columns per table, the hub's TABLES without the tables only the hub holds.
export const TABLE_FIELDS: Record<string, readonly string[]> = Object.fromEntries(['items', 'facts', 'pages', 'meetings', 'actions', 'jobs', 'runs', 'chats', 'briefs'].map((t) => [t, TABLES[t]]));

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
  rolls: number | null;
  rolled_from: number | null;
  rank: number | null;
  draft?: string | null;
  spent?: number | null;
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

export const rowKey = (r: { profile: string; id: string }) => `${r.profile}:${r.id}`;

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

// crypto.randomUUID only exists on secure origins; other Macs load the app over plain http.
export function newId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
