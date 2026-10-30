import { useEffect, useState, useSyncExternalStore } from 'react';
import { assistantStore, useAssistantData } from './data';
import type { ItemRow, Profile } from './data/sync';
import { estimateMin, focusTitle, minutesText } from './data/plan';
import { Icon } from '../ui/Icon';
import { save, stored } from '../ui/util';
import { showSnack } from './view';

// One focus timer at a time, kept in this browser so it survives a reload.
type Focus = { profile: Profile; id: string; title: string | null; start: number };
const KEY = 'codex-focus';
const subs = new Set<() => void>();
let cached: { raw: string | null; value: Focus | null } = { raw: null, value: null };

const read = () => {
  const raw = localStorage.getItem(KEY);
  if (raw !== cached.raw) cached = { raw, value: stored<Focus | null>(KEY, null) };
  return cached.value;
};
const write = (f: Focus | null) => {
  if (f) save(KEY, f); else localStorage.removeItem(KEY);
  subs.forEach((s) => s());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  window.addEventListener('storage', f);
  return () => { subs.delete(f); window.removeEventListener('storage', f); };
};

export const useFocus = () => useSyncExternalStore(subscribe, read);
export const isFocused = (f: Focus | null, r: ItemRow) => f?.profile === r.profile && f.id === r.id;

// Stopping adds the whole elapsed minutes to the task's spent minutes.
export function stopFocus() {
  const f = read();
  if (!f) return;
  const store = assistantStore();
  if (store.snapshot().phase !== 'ready') return showSnack('Unlock Codex to log the time');
  write(null);
  const min = Math.round((Date.now() - f.start) / 60_000);
  const row = store.snapshot().items.find((r) => r.profile === f.profile && r.id === f.id && !r.deleted);
  if (!row || min < 1) return showSnack(min < 1 ? 'Under a minute, not logged' : 'Task gone, time not logged');
  const before = row.spent ?? null;
  void store.update(row, { spent: (Number(before) || 0) + min });
  showSnack(`Logged ${minutesText(min)}`, () => void store.update(row, { spent: before }));
}

export function startFocus(r: ItemRow) {
  stopFocus();
  write({ profile: r.profile, id: r.id, title: r.title, start: Date.now() });
}

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
};

// A slim bar over Codex while a focus timer runs: the task, the time so far against its estimate, and Stop.
export function FocusBar() {
  const f = useFocus();
  const { items } = useAssistantData();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!f) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [f]);
  if (!f) return null;
  const row = items.find((r) => r.profile === f.profile && r.id === f.id);
  const title = row?.title ?? f.title;
  const est = estimateMin(title);
  const ms = now - f.start;
  const pct = est ? Math.min(100, (ms / (est * 60_000)) * 100) : 0;
  const over = est != null && ms > est * 60_000;
  return (
    <div className={`as-focus ${f.profile}${over ? ' over' : ''}`} role="region" aria-label="Focus timer">
      {est != null && <div className="as-focus-fill" style={{ width: `${pct}%` }} />}
      <Icon name="watch" small />
      <span className="as-focus-title">{focusTitle(title).slice(7) || '(Untitled)'}</span>
      <span className="as-focus-time" role="timer">{elapsed(ms)}{est != null && <span className="muted"> / {minutesText(est)}</span>}</span>
      <button className="btn sm" aria-label="Stop the focus timer" onClick={stopFocus}><Icon name="debug-stop" small /> Stop</button>
    </div>
  );
}
