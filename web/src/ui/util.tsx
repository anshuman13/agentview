import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { send } from '../app/store';

export function pressable(onClick: (e: MouseEvent<HTMLElement>) => void) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.currentTarget.click();
  };
  return { role: 'button' as const, tabIndex: 0, onClick, onKeyDown };
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

export function Hl({ text, hits, from = 0 }: { text: string; hits: number[]; from?: number }) {
  return <>{[...text].map((c, i) => (hits.includes(from + i) ? <b key={i}>{c}</b> : c))}</>;
}

// Re-renders every `ms` while `on`, for relative times; returns the time of the last tick.
export function useTick(ms: number, on = true) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
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
