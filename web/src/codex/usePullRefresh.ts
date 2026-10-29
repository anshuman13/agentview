import { useEffect, useRef, type RefObject } from 'react';
import { haptic } from '../ui/haptic';
import { isDragging } from './drag';

const TRIGGER = 64;
const MAX = 120;
const SLOP = 10;
const phone = () => matchMedia('(max-width: 900px)').matches;

// Pull down from the top of a scroller to refresh. Attach the returned ref to an absolutely placed indicator; it is moved by style, so a pull does not re-render.
export function usePullRefresh(scroller: RefObject<HTMLElement | null>, refresh: () => Promise<unknown>, on: unknown) {
  const ind = useRef<HTMLDivElement>(null);
  const run = useRef(refresh);
  run.current = refresh;

  useEffect(() => {
    const el = scroller.current, i = ind.current;
    if (!el || !i) return;
    let y0 = 0, x0 = 0, dy = 0, state: 'idle' | 'wait' | 'pull' | 'busy' = 'idle';
    const show = (y: number, ms = 0) => {
      i.style.transition = ms ? `transform ${ms}ms ease-out, opacity ${ms}ms` : 'none';
      i.style.transform = `translateY(${y}px) rotate(${y * 4}deg)`;
      i.style.opacity = String(Math.min(1, y / TRIGGER));
    };
    const settle = () => { state = 'idle'; show(0, 160); };
    const start = (e: TouchEvent) => {
      if (state === 'busy' || !phone() || el.scrollTop > 0 || e.touches.length !== 1) return;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; state = 'wait';
    };
    const move = (e: TouchEvent) => {
      if (state === 'idle' || state === 'busy') return;
      if (isDragging() || el.scrollTop > 0) { if (state === 'pull') settle(); else state = 'idle'; return; }
      const t = e.touches[0], y = t.clientY - y0;
      if (state === 'wait') {
        if (Math.abs(y) < SLOP && Math.abs(t.clientX - x0) < SLOP) return;
        if (y <= 0 || Math.abs(t.clientX - x0) > y) { state = 'idle'; return; }
        state = 'pull';
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.min(MAX, Math.max(0, y) * 0.5);
      show(dy);
    };
    const end = () => {
      if (state === 'wait') { state = 'idle'; return; }
      if (state !== 'pull') return;
      if (dy < TRIGGER * 0.5) return settle();
      state = 'busy';
      haptic('tap');
      show(TRIGGER * 0.6, 160);
      i.classList.add('spin');
      void run.current().catch(() => {}).finally(() => { i.classList.remove('spin'); settle(); });
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [scroller, on]);

  return ind;
}

// Marks the header `scrolled` once the scroller moves past a threshold; toggles the class only when the state changes.
export function useScrolledHeader(scroller: RefObject<HTMLElement | null>, on: unknown, past = 24) {
  useEffect(() => {
    const el = scroller.current, head = el?.parentElement?.querySelector('.as-head');
    if (!el || !head) return;
    const update = () => head.classList.toggle('scrolled', el.scrollTop > past);
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => { el.removeEventListener('scroll', update); head.classList.remove('scrolled'); };
  }, [scroller, on, past]);
}
