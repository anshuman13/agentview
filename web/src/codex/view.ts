import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { useBack } from '../app/back';
import { rowKey, type Profile } from './data/sync';

export type List = 'today' | 'tasks' | 'summary' | 'meetings' | 'jobs' | 'wiki';
export type Filter = 'all' | Profile;
export const FILTER_LABEL: Record<Filter, string> = { all: 'All', work: 'Work', personal: 'Personal' };

// The list, filter and open page or meeting are shared by the sidebar on desktop and the drawer on the phone.
export type View = { list: List; filter: Filter; open: string | null; anchor: string | null; person: string | null };

let view: View = { list: 'today', filter: 'all', open: null, anchor: null, person: null };
const subs = new Set<() => void>();

const depth = (v: View) => (v.open ? 1 : 0) + (v.person ? 1 : 0);

// The entry a page was opened from in a list, so going back focuses it again at the same scroll position.
type Spot = { list: List; scroll: number; index: number; text: string };
let spot: Spot | null = null;
const FOCUSABLE = 'button, a[href], input, [tabindex]:not([tabindex="-1"])';

function saveSpot(list: List) {
  const at = document.activeElement as HTMLElement | null;
  const scroller = at?.closest<HTMLElement>('.wk-scroll');
  if (!at || !scroller) return;
  spot = { list, scroll: scroller.scrollTop, index: [...scroller.querySelectorAll(FOCUSABLE)].indexOf(at), text: at.textContent ?? '' };
}

export function useSpotBack(scroller: RefObject<HTMLElement | null>, list: List) {
  useLayoutEffect(() => {
    const s = spot, el = scroller.current;
    spot = null;
    if (!s || s.list !== list || !el) return;
    el.scrollTop = s.scroll;
    const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const hit = all[s.index]?.textContent === s.text ? all[s.index] : all.find((b) => b.textContent === s.text);
    const at = document.activeElement;
    if (!at || at === document.body) hit?.focus({ preventScroll: true });
  }, []);
}

// Call before Dismiss removes a whole section: once it is gone, focus the next control below it, or the page heading.
export function focusPast(section: Element | null) {
  const scroller = section?.closest('.as-scroll');
  if (!section || !scroller) return;
  const below = [...scroller.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => section.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !section.contains(el));
  const heading = scroller.closest('.assistant')?.querySelector<HTMLElement>('h1');
  requestAnimationFrame(() => {
    if (section.isConnected) return;
    const to = below.find((el) => el.isConnected) ?? heading;
    if (to === heading) heading?.setAttribute('tabindex', '-1');
    to?.focus();
  });
}

// The direction of the last change drives the page transition in CSS.
export const setView = (patch: Partial<View>) => {
  const next = { ...view, ...patch };
  if (next.list !== view.list) spot = null;
  else if (!depth(view) && depth(next)) saveSpot(view.list);
  document.documentElement.dataset.nav = depth(next) > depth(view) ? 'push' : depth(next) < depth(view) ? 'pop' : 'switch';
  view = next;
  subs.forEach((f) => f());
};
// Switch to a list, then scroll the first new element matching the selector to the top once it renders.
export function setViewAt(patch: Partial<View>, selector: string) {
  const before = new Set(document.querySelectorAll(selector));
  setView(patch);
  const end = Date.now() + 1000;
  const find = () => {
    const el = [...document.querySelectorAll(selector)].find((e) => !before.has(e) && e.isConnected);
    if (el) el.scrollIntoView({ block: 'start' });
    else if (Date.now() < end) requestAnimationFrame(find);
  };
  requestAnimationFrame(find);
}
type MeetingRef = { profile: string; id: string };
export const openMeeting = (m: MeetingRef) => setView({ list: 'meetings', open: rowKey(m), person: null });
export const useView = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => view);

// Snackbar with Undo, one at a time.
const SNACK_MS = 5000;
type Snack = { text: string; undo?: () => void; id: number };
let snack: Snack | null = null;
const snackSubs = new Set<() => void>();
let snackTimer: ReturnType<typeof setTimeout> | undefined;
// A persistent status region so a screen reader hears each snack, even a repeat of the last one.
let live: HTMLElement | null = null;
function announce(text: string) {
  if (typeof document === 'undefined') return;
  if (!live) {
    live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    document.body.append(live);
  }
  const el = live;
  el.textContent = '';
  setTimeout(() => (el.textContent = text), 100);
}
export function showSnack(text: string, undo?: () => void) {
  snack = { text, undo, id: Date.now() };
  announce(undo ? `${text}. Undo available` : text);
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

// When an inline editor closes and focus fell to the page, it goes back to the button that opened it.
export function useFocusBack<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  const was = useRef(open);
  useEffect(() => {
    const at = document.activeElement;
    if (was.current && !open && (!at || at === document.body)) ref.current?.focus({ preventScroll: true });
    was.current = open;
  }, [open]);
  return ref;
}
