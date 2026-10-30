export const CAP = 5;

// Flattens the groups in rank order and keeps the first entry for each key, so an item shows once.
export function rankNeeds<T extends { keys: string[] }>(groups: T[][]): T[] {
  const seen = new Set<string>();
  return groups.flat().filter((n) => {
    if (n.keys.some((k) => seen.has(k))) return false;
    n.keys.forEach((k) => seen.add(k));
    return true;
  });
}
