import { useEffect, useRef, type RefObject } from 'react';
import { barHidden, barIdle, barState, type BarEvent } from '../../../../shared/bottomBar';
import { keyboardUp } from '../../app/touch/keyboardFlag';
import { touch } from '../../app/touch/touch';

// Marks the workbench with data-composing while the phone tab bar should get out of the composer's way.
// Without touch there is no keyboard event, so the bar stays hidden from focus to blur.
export function useBarHidden(ta: RefObject<HTMLTextAreaElement | null>, filled: boolean) {
  const state = useRef(barIdle);
  const emit = useRef((e: BarEvent) => {
    state.current = barState(state.current, e);
    document.querySelector('.workbench')?.toggleAttribute('data-composing', barHidden(state.current));
  });
  useEffect(() => emit.current(filled ? 'textFilled' : 'textEmpty'), [filled]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    const send = emit.current;
    const vv = window.visualViewport;
    const up = keyboardUp();
    let was = up();
    const resize = () => {
      const now = up();
      if (now === was) return;
      was = now;
      send(now ? 'keyboardUp' : 'keyboardDown');
    };
    const focus = () => send('focus');
    const blur = () => send('blur');
    el.addEventListener('focus', focus);
    el.addEventListener('blur', blur);
    if (touch()) vv?.addEventListener('resize', resize);
    return () => {
      el.removeEventListener('focus', focus);
      el.removeEventListener('blur', blur);
      vv?.removeEventListener('resize', resize);
      send('blur');
      send('textEmpty');
    };
  }, [ta]);
}
