import { useEffect, useSyncExternalStore } from 'react';
import { useBack } from '../app/back';
import type { Profile } from './data/sync';
import type { Meeting } from './data/wiki';

export type List = 'today' | 'tasks' | 'summary' | 'meetings' | 'jobs' | 'wiki';
export type Filter = 'all' | Profile;
export const FILTER_LABEL: Record<Filter, string> = { all: 'All', work: 'Work', personal: 'Personal' };

// The list, filter and open page or meeting are shared by the sidebar on desktop and the drawer on the phone.
export type View = { list: List; filter: Filter; open: string | null; anchor: string | null; person: string | null };

let view: View = { list: 'today', filter: 'all', open: null, anchor: null, person: null };
const subs = new Set<() => void>();

const depth = (v: View) => (v.open ? 1 : 0) + (v.person ? 1 : 0);

// The direction of the last change drives the page transition in CSS.
export const setView = (patch: Partial<View>) => {
  const next = { ...view, ...patch };
  document.documentElement.dataset.nav = depth(next) > depth(view) ? 'push' : depth(next) < depth(view) ? 'pop' : 'switch';
  view = next;
  subs.forEach((f) => f());
};
export const meetingKey = (m: Meeting) => `${m.profile}:${m.id}`;
export const openMeeting = (m: Meeting) => setView({ list: 'meetings', open: meetingKey(m), person: null });
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
export const copyText = (text: string, done = 'Copied') => void navigator.clipboard.writeText(text).then(() => showSnack(done), () => showSnack('Copy failed'));
export function hideSnack() {
  snack = null;
  snackSubs.forEach((f) => f());
}

// Escape (unless a field has focus) and the phone back button go back from a wiki page or meeting.
export function useEscapeBack(back: () => void) {
  useBack(back);
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
