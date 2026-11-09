import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { send } from '../app/store';
import type { Billing } from '../../../shared/providers';

// Enter or Space on a focusable element that is not a button clicks it.
export const clickOnKey = (e: KeyboardEvent<HTMLElement>) => {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  e.currentTarget.click();
};

export function pressable(onClick: (e: MouseEvent<HTMLElement>) => void) {
  return { role: 'button' as const, tabIndex: 0, onClick, onKeyDown: clickOnKey };
}

export const fitHeight = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

export const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Links from synced or model-written text open only as web or mail links.
export const safeHref = (url: string | null | undefined) => (url && /^(https?:|mailto:)/i.test(url) ? url : undefined);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const firstLine = (s: string | null) => s?.split('\n').find((l) => l.trim())?.trim() ?? '';

export const command = (id: string) => window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id } }));

// Brings the chat on screen: the Chat tab on a phone, the chat column on the desktop when it is hidden.
export function showChat() {
  if (window.innerWidth <= 900) command('tab:chat');
  else if (document.querySelector('.workbench')?.getAttribute('data-chat') === 'false') command('toggleChat');
}

// A pane sends a prompt and shows the chat, so the reply is seen.
export function askClaude(text: string) {
  showChat();
  send({ type: 'prompt', text });
}

// Relative time: now, 5m, 3h, 2d, 4w; a suffix such as ' ago' where a sentence needs one.
export function ago(t: number | string, suffix = '') {
  const at = typeof t === 'number' ? t : Date.parse(t);
  if (Number.isNaN(at)) return typeof t === 'string' ? t : '';
  const m = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (m < 1) return 'now';
  const text = m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : m < 10080 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 10080)}w`;
  return text + suffix;
}

export { wsUrl } from '../app/api';

export const stored = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback; } catch { return fallback; }
};
export const save = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
};

export const storedStrings = (key: string): string[] => {
  const v = stored<unknown>(key, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

export const readFlag = (key: string, fallback: boolean) => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
};
export const saveFlag = (key: string, on: boolean) => {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch {}
};

export function listKeys({ count, idx, setIdx, onEnter, onEscape }: { count: number; idx: number; setIdx: (i: number) => void; onEnter: () => void; onEscape: () => void }) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') onEscape();
    else if (e.key === 'ArrowDown') setIdx(Math.max(0, Math.min(idx + 1, count - 1)));
    else if (e.key === 'ArrowUp') setIdx(Math.max(0, Math.min(idx - 1, count - 1)));
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) onEnter();
    else return;
    e.preventDefault();
  };
}

export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// While `on`, remembers the focused element and puts focus back there on close, unless focus moved on.
export function useReturnFocus(on = true) {
  useEffect(() => {
    if (!on) return;
    const back = document.activeElement as HTMLElement | null;
    return () => {
      const at = document.activeElement;
      if ((!at || at === document.body) && back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [on]);
}

export function Hl({ text, hits, from = 0 }: { text: string; hits: number[]; from?: number }) {
  return <>{[...text].map((c, i) => (hits.includes(from + i) ? <b key={i}>{c}</b> : c))}</>;
}

// Re-renders every `ms` while `on`, for relative times; returns the time of the last tick.
export function useTick(ms: number, on = true) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => !document.hidden && setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

// Calls the latest `fn` when the component unmounts.
export function useOnUnmount(fn: () => void) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => () => latest.current(), []);
}

// Runs `fn` every `ms` while the tab is visible and `root` is on screen.
export function usePoll(root: RefObject<HTMLElement | null>, ms: number, fn: () => unknown, deps: unknown[]) {
  useEffect(() => {
    const t = setInterval(() => !document.hidden && root.current?.offsetParent && fn(), ms);
    return () => clearInterval(t);
  }, deps);
}

const WEEK_HOURS = 7 * 24;

// The share of the weekly limit used by now if it were spread evenly over the week, to the hour.
export function weekPace(resetsAt: number, now = Date.now()) {
  const left = Math.min(WEEK_HOURS, Math.max(0, Math.ceil((resetsAt - now) / 3_600_000)));
  return Math.round(((WEEK_HOURS - left) / WEEK_HOURS) * 100);
}

// The phone keyboard covers the lower half, so a focused field moves into view once it is up.
export const reveal = (e: { currentTarget: HTMLElement }) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300); };

export const money = (n: number, billing: Billing = 'usd') =>
  billing === 'plan' ? 'Plan' : billing === 'none' ? '-' : n > 0 && n < 0.005 ? '<$0.01' : n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;

export const modelLabel = (id: string, models: Array<{ value: string; displayName: string }>) =>
  models.find((m) => m.value === id)?.displayName ?? id.replace(/^claude-/, '').replace(/-\d{8}$/, '');

type Spend = { today: Record<string, number>; week: Record<string, number> };

export function spendLines(spends: Array<Spend | undefined>, models: Array<{ value: string; displayName: string }>, unpriced = false) {
  const sums = new Map<string, { today: number; week: number }>();
  for (const sp of spends) {
    if (!sp) continue;
    for (const w of ['today', 'week'] as const) {
      for (const [m, v] of Object.entries(sp[w])) {
        const cur = sums.get(m) ?? { today: 0, week: 0 };
        cur[w] += v;
        sums.set(m, cur);
      }
    }
  }
  if (!sums.size) return [];
  const all = [...sums.entries()];
  const total = all.reduce((t, [, v]) => ({ today: t.today + v.today, week: t.week + v.week }), { today: 0, week: 0 });
  const rows = all
    .filter(([, v]) => v.today >= 0.005 || v.week >= 0.005)
    .map(([m, v]) => ({ label: modelLabel(m, models), ...v }))
    .sort((a, b) => b.week - a.week || a.label.localeCompare(b.label));
  return [
    'Spend',
    ...rows.map((r) => `${r.label}: today ${money(r.today)}, 7 days ${money(r.week)}`),
    `Total: today ${money(total.today)}, 7 days ${money(total.week)}`,
    ...(unpriced ? ['Codex and OpenRouter chats are not priced'] : []),
    'Counts chats open on the Mac since the host last started',
    "Today is the Mac's day",
  ];
}

// Splits text into plain and matched pieces for the words of a query, ignoring case. Overlapping or touching matches merge into one piece.
export function markSegments(text: string, words: string[]): { text: string; hit: boolean }[] {
  if (!words.length) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  const ranges: [number, number][] = [];
  const lower = text.toLowerCase();
  for (const w of words) for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1)) ranges.push([i, i + w.length]);
  ranges.sort((a, b) => a[0] - b[0]);
  let at = 0;
  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  for (const [s, e] of merged) {
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

const MATCH_CAP = 500;

export function matchLabel(count: number): string {
  if (!count) return 'No matches';
  if (count > MATCH_CAP) return `${MATCH_CAP}+ matches`;
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
}

// The next current match from cur (-1 for none), wrapping at both ends.
export function stepMatch(cur: number, dir: 1 | -1, count: number): number {
  return cur < 0 && dir < 0 ? count - 1 : (cur + dir + count) % count;
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy failed');
}
