import { useEffect, useState, type RefObject } from 'react';

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const wsUrl = (query: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${query}`;

export const stored = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback; } catch { return fallback; }
};
export const save = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
};

export const readFlag = (key: string, fallback: boolean) => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
};
export const saveFlag = (key: string, on: boolean) => {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch {}
};

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

// Runs `fn` every `ms` while the tab is visible and `root` is on screen.
export function usePoll(root: RefObject<HTMLElement | null>, ms: number, fn: () => unknown, deps: unknown[]) {
  useEffect(() => {
    const t = setInterval(() => !document.hidden && root.current?.offsetParent && fn(), ms);
    return () => clearInterval(t);
  }, deps);
}
