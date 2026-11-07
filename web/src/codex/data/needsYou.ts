export const CAP = 5;

// Replaces the picked entries with one entry at the first one's place when there are at least min of them.
export function collapse<T>(rows: T[], pick: (x: T) => boolean, min: number, one: (xs: T[]) => T): T[] {
  const picked = rows.filter(pick);
  if (picked.length < min) return rows;
  const first = rows.findIndex(pick);
  return [...rows.slice(0, first), one(picked), ...rows.slice(first).filter((x) => !pick(x))];
}

// Flattens the groups in rank order and keeps the first entry for each key, so an item shows once. Marks hide later entries
// with that key without hiding the entry itself, so two asks from one message both show.
export function rankNeeds<T extends { keys: string[]; marks?: string[] }>(groups: T[][]): T[] {
  const seen = new Set<string>();
  return groups.flat().filter((n) => {
    if (n.keys.some((k) => seen.has(k))) return false;
    [...n.keys, ...(n.marks ?? [])].forEach((k) => seen.add(k));
    return true;
  });
}

const TASK_KINDS = ['overdue', 'overdueAll', 'risk', 'justEnded'];

export function groupNeeds<T extends { kind: string }>(rows: T[]): { key: 'tasks' | 'asks'; label: string; rows: T[] }[] {
  const tasks = rows.filter((x) => TASK_KINDS.includes(x.kind));
  const asks = rows.filter((x) => !TASK_KINDS.includes(x.kind));
  return [{ key: 'tasks' as const, label: 'Tasks', rows: tasks }, { key: 'asks' as const, label: 'Asks', rows: asks }].filter((g) => g.rows.length);
}
