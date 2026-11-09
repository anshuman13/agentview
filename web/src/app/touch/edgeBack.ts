import { isDragging } from '../../codex/gestures/drag';
import { haptic } from '../../ui/haptic';
import { useSwipeGesture } from './swipeGesture';

const EDGE_START = 20;
const MIN_DX = 70;
export const MAX_MS = 600;

type Point = { x: number; y: number };

function edgeBackEnd(start: Point, end: Point, ms: number, depth: number) {
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
  useSwipeGesture(
    (e) => edgeBackEnabled(navigator.userAgent, '__TAURI__' in window) && e.touches[0].clientX <= EDGE_START && !(e.target as Element).closest('.as-swipe-row') && !isDragging() && !getSelection()?.toString(),
    (from, t) => {
      if (innerWidth > 900) return;
      if (!edgeBackEnd(from, { x: t.clientX, y: t.clientY }, Date.now() - from.t, history.state?.av ?? 0)) return;
      haptic('tap');
      history.back();
    },
  );
}
