import { useRef, useState } from 'react';
import { haptic } from '../../ui/haptic';

export type Drop = { section: string; index: number };
export type Drag<T> = { item: T; key: string; title: string; x: number; y: number; over: Drop | null };

const HOLD = 350;
const SLOP = 8;
const EDGE = 64;

let active = false;
export const isDragging = () => active;

// The drop section under the point and the index among its rows, leaving out the dragged row.
function locate(x: number, y: number, key: string, attr: string): Drop | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  if (!el) return null;
  const rows = [...el.querySelectorAll<HTMLElement>(`[data-${attr}]`)].filter((r) => r.dataset[attr] !== key);
  const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
  return { section: el.dataset.drop!, index: i < 0 ? rows.length : i };
}

type Handlers<T> = {
  setDrag: (d: Drag<T> | null) => void;
  drop: React.MutableRefObject<(item: T, drop: Drop) => void>;
  hold: React.MutableRefObject<((item: T) => void) | undefined>;
  scroller: React.RefObject<HTMLElement | null>;
  attr: string;
};

// One pointer gesture on a row: from the press to the drop or cancel.
class DragGesture<T> {
  private pos: { x: number; y: number };
  private on = false;
  private moved = false;
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly touch: boolean;
  private readonly x0: number;
  private readonly y0: number;
  private readonly events: readonly [string, string, string];

  constructor(private item: T, private key: string, private title: string, e: React.PointerEvent, private h: Handlers<T>) {
    this.touch = e.pointerType !== 'mouse';
    this.x0 = e.clientX;
    this.y0 = e.clientY;
    this.pos = { x: this.x0, y: this.y0 };
    this.events = this.touch ? ['touchmove', 'touchend', 'touchcancel'] : ['pointermove', 'pointerup', 'pointercancel'];
    this.timer = this.touch ? setTimeout(this.begin, HOLD) : undefined;
    window.addEventListener(this.events[0], this.onMove, { passive: false });
    window.addEventListener(this.events[1], this.end);
    window.addEventListener(this.events[2], this.cancel);
    if (this.touch) window.addEventListener('contextmenu', quiet);
  }

  private show = () => this.h.setDrag({ item: this.item, key: this.key, title: this.title, ...this.pos, over: locate(this.pos.x, this.pos.y, this.key, this.h.attr) });

  private scroll = () => {
    const scroller = this.h.scroller.current;
    const box = scroller?.getBoundingClientRect();
    if (scroller && box) {
      const y = this.pos.y;
      const by = y < box.top + EDGE ? -(box.top + EDGE - y) / 4 : y > box.bottom - EDGE ? (y - box.bottom + EDGE) / 4 : 0;
      if (by) { scroller.scrollTop += by; this.show(); }
    }
    this.frame = requestAnimationFrame(this.scroll);
  };

  private begin = () => {
    this.on = active = true;
    if (this.touch) haptic('tap');
    this.show();
    this.frame = requestAnimationFrame(this.scroll);
  };

  private onMove = (ev: Event) => {
    const p = 'touches' in ev ? (ev as TouchEvent).touches[0] : (ev as PointerEvent);
    const far = Math.hypot(p.clientX - this.x0, p.clientY - this.y0) >= SLOP;
    if (far) this.moved = true;
    if (!this.on) {
      if (!far) return;
      if (this.touch) return this.stop();
      this.begin();
    }
    if (ev.cancelable) ev.preventDefault();
    this.pos = { x: p.clientX, y: p.clientY };
    this.show();
  };

  private stop = () => {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    window.removeEventListener(this.events[0], this.onMove);
    window.removeEventListener(this.events[1], this.end);
    window.removeEventListener(this.events[2], this.cancel);
    window.removeEventListener('contextmenu', quiet);
  };

  private end = () => {
    this.stop();
    if (!this.on) return;
    active = false;
    window.addEventListener('click', quiet, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', quiet, { capture: true }), 400);
    const over = locate(this.pos.x, this.pos.y, this.key, this.h.attr);
    this.h.setDrag(null);
    if (this.touch && !this.moved && this.h.hold.current) this.h.hold.current(this.item);
    else if (over) {
      if (this.touch) haptic('tap');
      this.h.drop.current(this.item, over);
    }
  };

  private cancel = () => { this.stop(); if (this.on) { active = false; this.h.setDrag(null); } };
}

const quiet = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };

// A mouse drags once it moves; a finger drags after holding still, so swipes and scrolling keep working. A finger released after the hold without moving calls onHold instead of dropping.
export function useDrag<T>(onDrop: (item: T, drop: Drop) => void, scroller: React.RefObject<HTMLElement | null>, attr = 'row', onHold?: (item: T) => void) {
  const [drag, setDrag] = useState<Drag<T> | null>(null);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  const hold = useRef(onHold);
  hold.current = onHold;

  const start = (item: T, key: string, title: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, textarea')) return;
    new DragGesture(item, key, title, e, { setDrag, drop, hold, scroller, attr });
  };

  return { drag, start };
}
