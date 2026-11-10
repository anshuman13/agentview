import { useEffect } from 'react';
import { touch } from './touch';

const isTextField = (el: Element | null) => !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|email|tel|password|number)$/.test(el.type)) || (el as HTMLElement).isContentEditable);

// Android's back gesture closes the keyboard but leaves the field focused, so the keyboard counts as up only while the viewport is short.
export const keyboardUp = () => {
  const vv = window.visualViewport;
  const tall = new Map<number, number>();
  return () => {
    const h = vv?.height ?? window.innerHeight;
    const full = Math.max(tall.get(window.innerWidth) ?? 0, h);
    tall.set(window.innerWidth, full);
    return h < full - 120;
  };
};

// Marks the workbench with data-kbd while a text field is focused and the phone keyboard is up.
export const useKeyboardFlag = () => {
  useEffect(() => {
    if (!touch()) return;
    const vv = window.visualViewport;
    const up = keyboardUp();
    const sync = () => document.querySelector('.workbench')?.toggleAttribute('data-kbd', isTextField(document.activeElement) && up());
    up();
    document.addEventListener('focusin', sync);
    const out = () => { setTimeout(sync); };
    document.addEventListener('focusout', out);
    vv?.addEventListener('resize', sync);
    return () => { document.removeEventListener('focusin', sync); document.removeEventListener('focusout', out); vv?.removeEventListener('resize', sync); };
  }, []);
};
