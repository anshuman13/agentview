import { useEffect, useState } from 'react';
import { isDragging } from '../gestures/drag';
import type { ItemRow } from '../data/sync';
import type { List } from '../view';

export const pickable = (r: ItemRow) => !r.deleted && (r.status === 'open' || r.status === 'suggested');

// Selection mode: the keys of the chosen tasks, or null when off.
export function useTaskSelection(list: List, items: ItemRow[], resetKey: unknown[], onAdd: () => void) {
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => setPicked(null), resetKey);
  useEffect(() => {
    if (!picked) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPicked(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [!!picked]);
  // The n key and the palette open the add sheet, except during a drag or selection.
  useEffect(() => {
    if (list !== 'tasks') return;
    const add = () => { if (!isDragging() && !picked) onAdd(); };
    window.addEventListener('tasks:add', add);
    return () => window.removeEventListener('tasks:add', add);
  }, [list, !!picked]);
  useEffect(() => {
    const live = new Set(items.filter(pickable).map((r) => r.profile + r.id));
    setPicked((p) => (p && [...p].some((k) => !live.has(k)) ? new Set([...p].filter((k) => live.has(k))) : p));
  }, [items]);
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return { picked, setPicked, toggle };
}
