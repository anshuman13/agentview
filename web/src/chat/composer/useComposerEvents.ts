import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { addUse, append, type Use } from './composerLogic';

type Target = { ta: RefObject<HTMLTextAreaElement | null>; wantCaret: MutableRefObject<number | null>; setText: Dispatch<SetStateAction<string>>; setUses: Dispatch<SetStateAction<Use[]>> };

export function useComposerEvents({ ta, wantCaret, setText, setUses }: Target) {
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
    const use = (e: Event) => {
      setUses((u) => addUse(u, (e as CustomEvent<Use>).detail));
      requestAnimationFrame(() => ta.current?.focus());
    };
    window.addEventListener('agentview:use', use);
    return () => window.removeEventListener('agentview:use', use);
  }, []);

  useEffect(() => {
    const focus = () => requestAnimationFrame(() => ta.current?.focus());
    window.addEventListener('agentview:focus', focus);
    return () => window.removeEventListener('agentview:focus', focus);
  }, []);
}
