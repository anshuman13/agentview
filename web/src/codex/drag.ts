import { useRef, useState } from 'react';

export type Drop = { section: string; index: number };
export type Drag<T> = { item: T; key: string; title: string; x: number; y: number; over: Drop | null };

const HOLD = 350;
const SLOP = 8;
const EDGE = 64;

let active = false;
export const isDragging = () => active;

// The drop section under the point and the index among its rows, leaving out the dragged row.
function locate(x: number, y: number, key: string): Drop | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  if (!el) return null;
  const rows = [...el.querySelectorAll<HTMLElement>('[data-row]')].filter((r) => r.dataset.row !== key);
  const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
  return { section: el.dataset.drop!, index: i < 0 ? rows.length : i };
}

// A mouse drags once it moves; a finger drags after holding still, so swipes and scrolling keep working.
export function useDrag<T>(onDrop: (item: T, drop: Drop) => void, scroller: React.RefObject<HTMLElement | null>) {
  const [drag, setDrag] = useState<Drag<T> | null>(null);
  const drop = useRef(onDrop);
  drop.current = onDrop;

  const start = (item: T, key: string, title: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, textarea')) return;
    const touch = e.pointerType !== 'mouse';
    const x0 = e.clientX;
    const y0 = e.clientY;
    let pos = { x: x0, y: y0 };
    let on = false;
    let frame = 0;
    const show = () => setDrag({ item, key, title, ...pos, over: locate(pos.x, pos.y, key) });
    const scroll = () => {
      const box = scroller.current?.getBoundingClientRect();
      if (box) {
        const by = pos.y < box.top + EDGE ? -(box.top + EDGE - pos.y) / 4 : pos.y > box.bottom - EDGE ? (pos.y - box.bottom + EDGE) / 4 : 0;
        if (by) { scroller.current!.scrollTop += by; show(); }
      }
      frame = requestAnimationFrame(scroll);
    };
    const begin = () => {
      on = active = true;
      if (touch) navigator.vibrate?.(10);
      show();
      frame = requestAnimationFrame(scroll);
    };
    const timer = touch ? setTimeout(begin, HOLD) : undefined;
    const move = (x: number, y: number, ev: Event) => {
      if (!on) {
        if (Math.hypot(x - x0, y - y0) < SLOP) return;
        if (touch) return stop();
        begin();
      }
      if (ev.cancelable) ev.preventDefault();
      pos = { x, y };
      show();
    };
    const onMove = (ev: Event) => {
      const p = 'touches' in ev ? (ev as TouchEvent).touches[0] : (ev as PointerEvent);
      move(p.clientX, p.clientY, ev);
    };
    const quiet = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
    const [moveEv, endEv, cancelEv] = touch ? ['touchmove', 'touchend', 'touchcancel'] as const : ['pointermove', 'pointerup', 'pointercancel'] as const;
    const stop = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener(moveEv, onMove);
      window.removeEventListener(endEv, end);
      window.removeEventListener(cancelEv, cancel);
      window.removeEventListener('contextmenu', quiet);
    };
    const end = () => {
      stop();
      if (!on) return;
      active = false;
      window.addEventListener('click', quiet, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', quiet, { capture: true }), 400);
      const over = locate(pos.x, pos.y, key);
      setDrag(null);
      if (over) drop.current(item, over);
    };
    const cancel = () => { stop(); if (on) { active = false; setDrag(null); } };
    window.addEventListener(moveEv, onMove, { passive: false });
    window.addEventListener(endEv, end);
    window.addEventListener(cancelEv, cancel);
    if (touch) window.addEventListener('contextmenu', quiet);
  };

  return { drag, start };
}
