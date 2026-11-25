import { useEffect, useRef, type PointerEvent } from 'react';
import { haptic } from './haptic';

const DISMISS_PX = 80;
const FLICK_PX_PER_MS = 0.5;
const SETTLE_MS = 180;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// A sheet with `ui-motion` settles with the motion tokens instead of SETTLE_MS ease-out.
const settle = (s: HTMLElement, closing: boolean) => s.classList.contains('ui-motion')
  ? { ms: parseFloat(getComputedStyle(s).getPropertyValue('--motion-duration')) || SETTLE_MS, ease: `var(${closing ? '--motion-ease-out' : '--motion-ease-in'})` }
  : { ms: SETTLE_MS, ease: 'ease-out' };

// Drag-to-dismiss for a bottom sheet. Spread `handle` on the grab handle; attach `overlay` and `sheet` refs.
export function useSheetDrag(open: boolean, onClose: () => void) {
  const sheet = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const pos = useRef({ y0: 0, y: 0, t: 0, v: 0 });

  useEffect(() => { if (open) haptic('tap'); }, [open]);

  const move = (y: number, animate: boolean, closing = false) => {
    const s = sheet.current, o = overlay.current;
    if (!s || !o) return;
    const { ease, ms: settleMs } = settle(s, closing);
    const ms = animate && !reduced() ? settleMs : 0;
    s.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
    o.style.transition = ms ? `background-color ${ms}ms ${ease}` : 'none';
    s.style.transform = y ? `translateY(${y}px)` : '';
    o.style.setProperty('--sheet-fade', String(Math.max(0, 1 - y / (s.offsetHeight || 1))));
  };

  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closing.current), []);
  const close = () => {
    if (closing.current) return;
    if (!sheet.current) return onClose();
    const s = sheet.current;
    move(s.offsetHeight + 48, true, true);
    closing.current = setTimeout(() => {
      closing.current = undefined;
      onClose();
    }, reduced() ? 0 : settle(s, true).ms);
  };

  const handle = {
    onPointerDown: (e: PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      pos.current = { y0: e.clientY, y: 0, t: e.timeStamp, v: 0 };
    },
    onPointerMove: (e: PointerEvent) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const p = pos.current, y = Math.max(0, e.clientY - p.y0);
      p.v = e.timeStamp > p.t ? (y - p.y) / (e.timeStamp - p.t) : p.v;
      p.y = y;
      p.t = e.timeStamp;
      move(y, false);
    },
    onPointerUp: (e: PointerEvent) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const { y, v } = pos.current;
      if (y > DISMISS_PX || (y > 10 && v > FLICK_PX_PER_MS)) close();
      else move(0, true);
    },
    onPointerCancel: () => move(0, true),
  };

  return { sheet, overlay, handle, close };
}
