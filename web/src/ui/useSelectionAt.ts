import { useEffect, useRef, useState, type RefObject } from 'react';

export type SelectionAt = { quote: string; x: number; y: number };

// Text selected inside body that accept takes, placed under the selection in the scroller's coordinates. Esc hides it.
export function useSelectionAt(body: RefObject<HTMLElement | null>, scroller: RefObject<HTMLElement | null>, accept: (sel: Selection) => boolean) {
  const [at, setAt] = useState<SelectionAt | null>(null);
  const open = useRef(false);
  const takes = useRef(accept);
  takes.current = accept;
  useEffect(() => {
    const read = () => {
      if (open.current) return;
      const sel = document.getSelection();
      const el = body.current;
      const box = scroller.current;
      const quote = sel?.toString().trim() ?? '';
      if (!sel || !el || !box || !quote || sel.rangeCount === 0 || !el.contains(sel.anchorNode) || !takes.current(sel)) return setAt(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setAt({ quote, x: Math.max(8, Math.min(r.left - b.left, b.width - 320)), y: r.bottom - b.top + box.scrollTop + 6 });
    };
    let t: ReturnType<typeof setTimeout>;
    const later = () => {
      clearTimeout(t);
      t = setTimeout(read, 250);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !open.current && setAt(null);
    document.addEventListener('selectionchange', later);
    document.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('selectionchange', later);
      document.removeEventListener('keydown', esc);
    };
  }, [body, scroller]);
  return { at, clear: () => setAt(null), open };
}
