import { useState } from 'react';

const STEP = 50;

// Show the first rows of a long list; a new key (search, filter, page) starts the window over.
export function useWindow(key: string): [number, () => void] {
  const [w, setW] = useState({ key, n: STEP });
  if (w.key !== key) setW({ key, n: STEP });
  const n = w.key === key ? w.n : STEP;
  return [n, () => setW({ key, n: n + STEP })];
}

// Keep the first n rows across groups and drop groups left empty.
export function capGroups<K extends string, G extends Record<K, unknown[]>>(groups: G[], n: number, key: K): G[] {
  let left = n;
  return groups.flatMap((g) => {
    if (left <= 0) return [];
    const rows = g[key].slice(0, left);
    left -= rows.length;
    return [{ ...g, [key]: rows }];
  });
}

export function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (total <= shown) return null;
  return <button className="btn" onClick={onMore}>Show more ({total - shown})</button>;
}
