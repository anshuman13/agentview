import { useEffect, useReducer } from 'react';
import { useNarrow } from '../../app/shell/useNarrow';

const choices = new Map<string, boolean>();

export function useCardOpen(key: string, needsYou: boolean) {
  const narrow = useNarrow();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (narrow && needsYou && !choices.has(key)) { choices.set(key, true); redraw(); }
  }, [narrow, needsYou, key]);
  if (!narrow) return undefined;
  const open = choices.get(key) ?? needsYou;
  return { open, toggle: () => { choices.set(key, !open); redraw(); } };
}
