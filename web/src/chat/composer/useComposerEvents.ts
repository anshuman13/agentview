import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { MAC } from '../../app/shell/keys';
import type { Pick } from '../ChatSettings';
import { append } from './composerLogic';

type Target = { ta: RefObject<HTMLTextAreaElement | null>; wantCaret: MutableRefObject<number | null>; setText: Dispatch<SetStateAction<string>>; setPick: Dispatch<SetStateAction<Pick | null>>; root: RefObject<HTMLDivElement | null>; canEffort: boolean };

const PICK_KEYS: Record<string, 'model' | 'mode' | 'effort'> = { KeyI: 'model', KeyM: 'mode', KeyE: 'effort' };

export function useComposerEvents({ ta, wantCaret, setText, setPick, root, canEffort }: Target) {
  const effortAllowed = useRef(canEffort);
  effortAllowed.current = canEffort;

  useEffect(() => {
    const insert = (e: Event) => {
      const add = (e as CustomEvent<{ text: string }>).detail.text;
      setText((t) => {
        const next = append(t, add);
        wantCaret.current = next.length;
        return next;
      });
      requestAnimationFrame(() => ta.current?.focus());
    };
    window.addEventListener('agentview:insert', insert);
    return () => window.removeEventListener('agentview:insert', insert);
  }, []);

  useEffect(() => {
    const focus = () => requestAnimationFrame(() => ta.current?.focus());
    window.addEventListener('agentview:focus', focus);
    return () => window.removeEventListener('agentview:focus', focus);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const kind = PICK_KEYS[e.code];
      if (!kind || !e.shiftKey || e.altKey || !(MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return;
      if (kind === 'effort' && !effortAllowed.current) return;
      const chip = root.current?.querySelector<HTMLElement>('.cp-mode');
      if (!chip || chip.offsetParent == null) return;
      e.preventDefault();
      const at = chip.getBoundingClientRect();
      setPick((p) => (p?.kind === kind ? null : { kind, at }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
