import { useEffect, useSyncExternalStore } from 'react';
import type { Profile } from '../../assistant/sync';

export type List = 'today' | 'upcoming' | 'meetings' | 'wiki' | 'notes' | 'done';
export type Filter = 'all' | Profile;

// The list, filter and open page or meeting are shared by the sidebar on desktop and the drawer on the phone.
export type View = { list: List; filter: Filter; open: string | null; anchor: string | null };

let view: View = { list: 'today', filter: 'all', open: null, anchor: null };
const subs = new Set<() => void>();

export const setView = (patch: Partial<View>) => {
  view = { ...view, ...patch };
  subs.forEach((f) => f());
};
export const useView = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => view);

// Snackbar with Undo, one at a time.
const SNACK_MS = 5000;
type Snack = { text: string; undo?: () => void; id: number };
let snack: Snack | null = null;
const snackSubs = new Set<() => void>();
let snackTimer: ReturnType<typeof setTimeout> | undefined;
export function showSnack(text: string, undo?: () => void) {
  snack = { text, undo, id: Date.now() };
  snackSubs.forEach((f) => f());
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnack, SNACK_MS);
}
export const useSnack = () => useSyncExternalStore((f) => (snackSubs.add(f), () => snackSubs.delete(f)), () => snack);
export function hideSnack() {
  snack = null;
  snackSubs.forEach((f) => f());
}

// Escape goes back from a wiki page or meeting unless a field has focus.
export function useEscapeBack(back: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || e.defaultPrevented || el?.closest('input, textarea, [contenteditable]')) return;
      back();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
}
