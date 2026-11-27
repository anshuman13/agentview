import { useEffect, useRef, type RefObject } from 'react';

// Key presses for a pending card: the first card takes them, any other only while focus is inside it.
export function useCardKeys(ref: RefObject<HTMLElement | null>, first: boolean, onKey: (key: string) => boolean | void) {
  const cb = useRef(onKey);
  cb.current = onKey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || document.querySelector('.overlay')) return;
      const el = document.activeElement;
      if (el?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (!first && !(el && ref.current?.contains(el))) return;
      if (cb.current(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [first, ref]);
}
