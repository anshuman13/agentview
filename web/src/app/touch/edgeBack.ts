import { useEffect } from 'react';
import { isDragging } from '../../codex/drag';
import { haptic } from '../../ui/haptic';

const EDGE_START = 20;
const MIN_DX = 70;
export const MAX_MS = 600;

type Point = { x: number; y: number };

export function edgeBackEnd(start: Point, end: Point, ms: number, depth: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return depth > 0 && start.x <= EDGE_START && ms < MAX_MS && dx >= MIN_DX && dx >= 2 * Math.abs(dy);
}

export function edgeBackEnabled(userAgent: string | undefined, tauri: boolean) {
  const android = Number(/Android (\d+)/.exec(userAgent ?? '')?.[1]);
  return !(tauri && android >= 10);
}

// On the phone a right swipe from the left edge closes the topmost open layer, like the native back.
export function useEdgeBack() {
  useEffect(() => {
    let start: (Point & { t: number }) | null = null;
    const down = (e: TouchEvent) => {
      if (!edgeBackEnabled(navigator.userAgent, '__TAURI__' in window)) return;
      const t = e.touches[0];
      start = e.touches.length === 1 && t.clientX <= EDGE_START && !(e.target as Element).closest('.as-swipe-row') && !isDragging() && !getSelection()?.toString() ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    };
    const up = (e: TouchEvent) => {
      const from = start;
      start = null;
      if (!from || innerWidth > 900) return;
      const t = e.changedTouches[0];
      if (!edgeBackEnd(from, { x: t.clientX, y: t.clientY }, Date.now() - from.t, history.state?.av ?? 0)) return;
      haptic('tap');
      history.back();
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
