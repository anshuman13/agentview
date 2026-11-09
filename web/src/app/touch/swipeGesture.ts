import { useEffect } from 'react';

export type SwipeStart = { x: number; y: number; t: number };

// Tracks a one-finger touch that `begins` accepts and calls `onSwipe` with its start and its lift point.
export function useSwipeGesture(begins: (e: TouchEvent) => boolean, onSwipe: (from: SwipeStart, to: Touch) => void) {
  useEffect(() => {
    let start: SwipeStart | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && begins(e) ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    };
    const up = (e: TouchEvent) => {
      const from = start;
      start = null;
      if (from) onSwipe(from, e.changedTouches[0]);
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
