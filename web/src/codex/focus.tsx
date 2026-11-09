import { useEffect, useState, useSyncExternalStore } from 'react';
import { assistantStore, useAssistantTable } from './data';
import type { ItemRow, Profile } from './data/sync';
import { estimateMin, focusTitle, minutesText } from './data/tasks/plan';
import { appendSession } from './data/tasks/timeLog';
import { apiUrl, fetchJson } from '../app/api';
import { Icon } from '../ui/Icon';
import { save, stored } from '../ui/util';
import { showSnack } from './view';

// One focus timer at a time, kept in this browser so it survives a reload.
type Focus = { profile: Profile; id: string; title: string | null; start: number; end?: number };
const LENGTH = 25;
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

// The server sends one push when a timed focus ends. Offline, the timer still works without it.
const push = (method: 'POST' | 'DELETE', body?: { title: string | null; end: number }) =>
  void fetchJson(apiUrl('/api/focus'), { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }).catch(() => {});

// Stopping adds the whole elapsed minutes to the task's spent minutes, at most 25 for a timed focus. False when the hub is locked.
function finish() {
  const f = read();
  if (!f) return true;
  const store = assistantStore();
  if (store.snapshot().phase !== 'ready') return showSnack('Unlock Codex to log the time'), false;
  write(null);
  const min = Math.min(Math.round((Date.now() - f.start) / 60_000), f.end ? LENGTH : Infinity);
  const row = store.snapshot().items.find((r) => r.profile === f.profile && r.id === f.id && !r.deleted);
  if (!row || min < 1) return showSnack(min < 1 ? 'Under a minute, not logged' : 'Task gone, time not logged');
  const before = { spent: row.spent ?? null, time_log: row.time_log ?? null };
  void store.update(row, { spent: (Number(before.spent) || 0) + min, time_log: appendSession(before.time_log, { id: String(f.start), at: f.start, min }) });
  showSnack(`Logged ${minutesText(min)}`, () => void store.update(row, before));
  return true;
}

export function stopFocus() {
  if (finish()) push('DELETE');
}

function discardFocus() {
  write(null);
  push('DELETE');
}

export const stopFocusFor = (r: ItemRow) => { if (isFocused(read(), r)) stopFocus(); };

export function startFocus(r: ItemRow, minutes?: number) {
  finish();
  const start = Date.now();
  const end = minutes ? start + minutes * 60_000 : undefined;
  write({ profile: r.profile, id: r.id, title: r.title, start, ...(end ? { end } : {}) });
  if (end) push('POST', { title: r.title, end }); else push('DELETE');
}

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => !document.hidden && setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
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
  const items = useAssistantTable('items');
  const now = useNow(Boolean(f));
  if (!f) return null;
  const row = items.find((r) => r.profile === f.profile && r.id === f.id);
  const title = row?.title ?? f.title;
  const est = estimateMin(title);
  const ms = now - f.start;
  if (f.end) {
    const left = f.end - now;
    return (
      <div className={`as-focus ${f.profile}`} role="region" aria-label="Focus timer">
        <div className="as-focus-fill" style={{ width: `${Math.min(100, (ms / (LENGTH * 60_000)) * 100)}%` }} />
        <Icon name="watch" small />
        <span className="as-focus-title">{focusTitle(title).slice(7) || '(Untitled)'}</span>
        {left > 0
          ? <><span className="as-focus-time" role="timer">{elapsed(left)}</span><button className="btn sm" aria-label="Stop the focus timer" onClick={stopFocus}><Icon name="debug-stop" small /> Stop</button></>
          : <><span className="as-focus-time over">Time's up</span><button className="btn sm" onClick={stopFocus}>Log {LENGTH}m</button><button className="btn sm" onClick={discardFocus}>Discard</button></>}
      </div>
    );
  }
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
