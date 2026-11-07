import { useEffect, useRef, type PointerEvent } from 'react';
import { haptic } from './haptic';
import { PHONE } from './Menu';

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 10;

export function createLongPress(onFire: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;
  let origin = { x: 0, y: 0 };
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const cancel = () => { clear(); fired = false; };
  return {
    start(x: number, y: number) {
      cancel();
      origin = { x, y };
      timer = setTimeout(() => { timer = undefined; fired = true; onFire(); }, LONG_PRESS_MS);
    },
    move(x: number, y: number) {
      if (Math.hypot(x - origin.x, y - origin.y) > LONG_PRESS_SLOP) clear();
    },
    end() {
      const was = fired;
      cancel();
      return was;
    },
    cancel,
  };
}

export function useLongPress(onLongPress?: () => void) {
  const fire = useRef(onLongPress);
  fire.current = onLongPress;
  const press = useRef<ReturnType<typeof createLongPress>>(undefined);
  const stopSwallow = useRef<() => void>(undefined);
  if (!press.current) press.current = createLongPress(() => { haptic('tap'); fire.current?.(); });
  useEffect(() => () => { press.current?.cancel(); stopSwallow.current?.(); }, []);
  if (!onLongPress) return undefined;
  const swallowClick = (row: HTMLElement) => {
    stopSwallow.current?.();
    const swallow = (ev: MouseEvent) => {
      stopSwallow.current?.();
      if (!row.contains(ev.target as Node)) return;
      ev.stopPropagation();
      ev.preventDefault();
    };
    const timer = setTimeout(() => stopSwallow.current?.(), 400);
    stopSwallow.current = () => {
      clearTimeout(timer);
      document.removeEventListener('click', swallow, true);
      stopSwallow.current = undefined;
    };
    document.addEventListener('click', swallow, true);
  };
  return {
    down: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' || !matchMedia(PHONE).matches) return;
      if (e.isPrimary) press.current!.start(e.clientX, e.clientY);
      else press.current!.cancel();
    },
    move: (e: PointerEvent<HTMLElement>) => press.current!.move(e.clientX, e.clientY),
    up: (e: PointerEvent<HTMLElement>) => { if (press.current!.end()) swallowClick(e.currentTarget); },
    cancel: () => press.current!.cancel(),
    menu: (e: Event) => { if (matchMedia(PHONE).matches) e.preventDefault(); },
  };
}
