import { useSyncExternalStore } from 'react';

const NARROW_PX = 900;
const NARROW = `(max-width: ${NARROW_PX}px)`;

// One query for every caller, so a render does not build a new one.
let query: MediaQueryList | undefined;
const mq = () => (query ??= matchMedia(NARROW));

const subscribe = (cb: () => void) => {
  mq().addEventListener('change', cb);
  return () => mq().removeEventListener('change', cb);
};

export const narrow = () => innerWidth <= NARROW_PX;

export const useNarrow = () => useSyncExternalStore(subscribe, () => mq().matches, () => false);
