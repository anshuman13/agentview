import { useLayoutEffect, type RefObject } from 'react';

const MAX_HEIGHT = 220;

export function useAutoHeight(ta: RefObject<HTMLTextAreaElement | null>, mirror: RefObject<HTMLDivElement | null>, wantCaret: { current: number | null }, setCaret: (n: number) => void, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0';
    const h = Math.max(el.scrollHeight, mirror.current?.offsetHeight ?? 0);
    el.style.height = `${Math.min(h, MAX_HEIGHT)}px`;
    if (mirror.current) mirror.current.style.visibility = h > MAX_HEIGHT ? 'hidden' : '';
    if (wantCaret.current !== null) {
      el.setSelectionRange(wantCaret.current, wantCaret.current);
      setCaret(wantCaret.current);
      wantCaret.current = null;
    }
  }, deps);
}
