import { useEffect, useRef } from 'react';
import { useSwipeGesture } from './swipeGesture';

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

  useSwipeGesture(
    (e) => {
      const x = e.touches[0].clientX;
      const target = e.target as Element;
      return x > EDGE && x < innerWidth - EDGE && !target.closest(OWN) && !scrollsSideways(target) && !getSelection()?.toString();
    },
    (from, t) => {
      if (innerWidth > 900) return;
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      if (Date.now() - from.t >= 400 || Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      const { index: i, count: n, go: move } = latest.current;
      const next = i + (dx < 0 ? 1 : -1);
      if (i < 0 || next < 0 || next >= n) return;
      move(next);
    },
  );
}
