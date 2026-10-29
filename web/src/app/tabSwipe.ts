import { useEffect, useRef } from 'react';

// Places where a sideways drag belongs to the content: row swipes, text, code, sheets, and anything that scrolls sideways.
const OWN = '.as-swipe-row, input, textarea, pre, code, .xterm, .chrome-frame, .monaco-editor, .tabs, .as-sheet, .more-sheet, .as-drawer, .palette, [role="dialog"], [data-no-swipe]';
const EDGE = 24;
let forced: 1 | -1 | null = null;

// Opening a chat from Sessions is a push, so the chat comes in from the right even though its tab sits to the left.
export const slideFrom = (side: 1 | -1) => { forced = side; };

function scrollsSideways(el: Element | null) {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

// On the phone a quick sideways swipe moves between the bottom tabs, and every tab change slides the new pane in from its side.
export function useTabSwipe(index: number, count: number, go: (i: number) => void) {
  const prev = useRef(index);
  const latest = useRef({ index, count, go });
  latest.current = { index, count, go };

  useEffect(() => {
    const from = prev.current;
    prev.current = index;
    const side = forced ?? (index > from ? 1 : -1);
    forced = null;
    if (from === index || index < 0 || from < 0 || matchMedia('(min-width: 901px), (prefers-reduced-motion: reduce)').matches) return;
    const pane = [...document.querySelectorAll<HTMLElement>('.workbench > .body > .pane')].find((p) => p.offsetParent !== null);
    pane?.animate([{ opacity: 0.4, transform: `translateX(${side * 32}px)` }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }, [index]);

  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      const target = e.target as Element;
      start = e.touches.length === 1 && t.clientX > EDGE && t.clientX < innerWidth - EDGE && !target.closest(OWN) && !scrollsSideways(target) && !getSelection()?.toString() ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    };
    const up = (e: TouchEvent) => {
      if (!start || innerWidth > 900) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = Date.now() - start.t < 400;
      start = null;
      if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      const { index: i, count: n, go: move } = latest.current;
      const next = i + (dx < 0 ? 1 : -1);
      if (i < 0 || next < 0 || next >= n) return;
      move(next);
    };
    const cancel = () => { start = null; };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchend', up, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', cancel);
    };
  }, []);
}
