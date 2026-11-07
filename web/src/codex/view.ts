import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { useBack } from '../app/back';
import { rowKey, type Profile } from './data/sync';
import { errorText } from './data/engine';
import { seriesKey, seriesTitleOf } from './data/meetings';
import type { Meeting } from './data/wiki';
import { clearScroll, saveScroll, takeScroll } from './scrollStore';
import { PHONE } from '../ui/Menu';

export type List = 'today' | 'tasks' | 'summary' | 'meetings' | 'jobs' | 'wiki' | 'goals' | 'search';
export type Filter = 'all' | Profile;
export const FILTER_LABEL: Record<Filter, string> = { all: 'All', work: 'Work', personal: 'Personal' };

// The list, filter and open page, meeting or task are shared by the sidebar on desktop and the drawer on the phone.
export type View = { list: List; filter: Filter; open: string | null; anchor: string | null; person: string | null; series: string | null; tag: string | null };

// The list open before the current one (never goals or search), so Back from either page lands there.
let prevList: List = 'today';
let fromWeek = false;
let weekReturn = false;

let view: View = { list: 'today', filter: 'all', open: null, anchor: null, person: null, series: null, tag: null };
const subs = new Set<() => void>();

const depth = (v: View) => (v.open ? 1 : 0) + (v.person ? 1 : 0) + (v.series ? 1 : 0) + (v.tag ? 1 : 0);

// The entry a page was opened from in a list, so going back focuses it again at the same scroll position.
type Spot = { list: List; scroll: number; index: number; text: string };
let spot: Spot | null = null;
const FOCUSABLE = 'button, a[href], input, [tabindex]:not([tabindex="-1"])';

function saveSpot(list: List) {
  const at = document.activeElement as HTMLElement | null;
  const scroller = at?.closest<HTMLElement>('.wk-scroll, .as-scroll');
  if (!at || !scroller) return;
  spot = { list, scroll: scroller.scrollTop, index: [...scroller.querySelectorAll(FOCUSABLE)].indexOf(at), text: at.textContent ?? '' };
}

const LIST_SCROLLER: Partial<Record<List, string>> = { tasks: '.as-scroll', meetings: '.wk-scroll' };

function saveListScroll(list: List) {
  const selector = LIST_SCROLLER[list];
  if (!selector || !matchMedia(PHONE).matches) return;
  const scroller = document.querySelector(selector);
  if (scroller) saveScroll(`${list}:${view.filter}`, scroller.scrollTop);
}

export function useSpotBack(scroller: RefObject<HTMLElement | null>, list: List) {
  useLayoutEffect(() => {
    const s = spot, el = scroller.current, top = takeScroll(`${list}:${view.filter}`);
    spot = null;
    if (el && top !== null) el.scrollTop = top;
    if (!s || s.list !== list || !el) return;
    if (top === null) el.scrollTop = s.scroll;
    const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const hit = all[s.index]?.textContent === s.text ? all[s.index] : all.find((b) => b.textContent === s.text);
    const at = document.activeElement;
    if (!at || at === document.body) hit?.focus({ preventScroll: true });
  }, []);
}

// The direction of the last change drives the page transition in CSS.
export const setView = (patch: Partial<View>) => {
  const next = { ...view, ...patch };
  if (next.list !== view.list && patch.tag === undefined) next.tag = null;
  if (next.list !== view.list) {
    spot = null;
    clearScroll(view.list);
    if (view.list === 'goals' || view.list === 'search') fromWeek = false;
    else prevList = view.list;
  }
  else if (!depth(view) && depth(next)) {
    saveSpot(view.list);
    saveListScroll(view.list);
  }
  document.documentElement.dataset.nav = depth(next) > depth(view) ? 'push' : depth(next) < depth(view) ? 'pop' : 'switch';
  view = next;
  subs.forEach((f) => f());
};
export function openWeekGoals() {
  setView({ list: 'goals' });
  fromWeek = true;
}
export function openWeek() {
  weekReturn = true;
  setView({ list: 'meetings' });
}
export const previousList = () => prevList;
export function leaveOverlay() {
  weekReturn = fromWeek && prevList === 'meetings';
  setView({ list: prevList });
}
// The query handed to Search by openSearch; seq changes on every call so a mounted Search restarts with it.
let searchQuery = '';
let searchSeq = 0;
export function openSearch(query: string) {
  searchQuery = query;
  searchSeq++;
  setView({ list: 'search', open: null, person: null, series: null, tag: null });
}
export const searchRun = () => searchSeq;
export function takeSearchQuery() {
  const q = searchQuery;
  searchQuery = '';
  return q;
}
// True once after Back from the goals page opened in Week, so Meetings starts on Week.
export function takeWeekReturn() {
  const w = weekReturn;
  weekReturn = false;
  return w;
}
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
export const openMeeting = (m: MeetingRef) => setView({ list: 'meetings', open: rowKey(m), person: null, series: null, tag: null });
// The meeting whose notes field takes focus when its page opens from the row's Notes item; the page clears it.
let notesFor: string | null = null;
export const openMeetingNotes = (m: MeetingRef) => {
  notesFor = rowKey(m);
  openMeeting(m);
};
export const notesFocusFor = (key: string) => notesFor === key;
export const clearNotesFocus = () => { notesFor = null; };
export const openTask = (t: MeetingRef) => setView({ list: 'tasks', open: rowKey(t), person: null, series: null, tag: null });
export const openSeries = (m: Meeting) => setView({ list: 'meetings', series: seriesKey(m.profile, seriesTitleOf(m)), person: null, tag: null });
export const openTag = (tag: string) => setView({ list: 'tasks', tag, open: null, person: null, series: null });
export const useView = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => view);

// Snackbar with Undo, one at a time.
const SNACK_MS = 5000;
type Snack = { text: string; undo?: () => void; id: number };
let snack: Snack | null = null;
let snackId = 0;
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
export function showSnack(text: string, undo?: () => void, ms = SNACK_MS) {
  snack = { text, undo, id: ++snackId };
  announce(undo ? `${text}. Undo available` : text);
  snackSubs.forEach((f) => f());
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnack, ms);
}
export const useSnack = () => useSyncExternalStore((f) => (snackSubs.add(f), () => snackSubs.delete(f)), () => snack);
export const copyText = (text: string, done = 'Copied') => void navigator.clipboard.writeText(text).then(() => showSnack(done), () => showSnack('Copy failed'));
export function hideSnack() {
  snack = null;
  snackSubs.forEach((f) => f());
}

// Escape (unless a field has focus, or inField is set) and the phone back button go back from a wiki page or meeting.
export function useEscapeBack(back: () => void, { inField = false } = {}) {
  useBack(back);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || e.defaultPrevented || (!inField && el?.closest('input, textarea, [contenteditable]'))) return;
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

// Runs a change and reports a failure as "<failText>: <why>" in the snack; true when it went through.
export async function attempt(task: () => Promise<unknown>, failText: string) {
  try {
    await task();
    return true;
  } catch (err) {
    showSnack(`${failText}: ${errorText(err)}`);
    return false;
  }
}
