import { useEffect } from 'react';
import { touch } from './touch';
import { narrow } from '../shell/useNarrow';

export const KEYBOARD_MIN = 100;

export const keyboardInset = (layoutHeight: number, vvHeight: number, vvOffsetTop: number) => {
  const inset = Math.round(Math.max(0, layoutHeight - vvHeight - vvOffsetTop));
  return inset < KEYBOARD_MIN ? 0 : inset;
};

// Sets --kb-inset on the root while the phone keyboard shrinks the visual viewport. Checked on every event, so a rotation past 900px clears it.
export const useKeyboardInset = () => {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!touch() || !vv) return;
    const root = document.documentElement;
    let last = 0;
    const sync = () => {
      const inset = !narrow() ? 0 : keyboardInset(window.innerHeight, vv.height, vv.offsetTop);
      if (inset === last) return;
      last = inset;
      if (inset) root.style.setProperty('--kb-inset', `${inset}px`);
      else root.style.removeProperty('--kb-inset');
      const el = document.activeElement;
      if (inset && el instanceof HTMLElement && el.closest('.as-page .wk-scroll') && el.matches('input, textarea')) el.scrollIntoView({ block: 'nearest' });
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    sync();
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      root.style.removeProperty('--kb-inset');
    };
  }, []);
};
