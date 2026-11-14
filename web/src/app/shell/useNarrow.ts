import { useSyncExternalStore } from 'react';

const NARROW_PX = 900;
const NARROW = `(max-width: ${NARROW_PX}px)`;

const subscribe = (cb: () => void) => {
  const mq = matchMedia(NARROW);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

export const narrow = () => innerWidth <= NARROW_PX;

export const useNarrow = () => useSyncExternalStore(subscribe, () => matchMedia(NARROW).matches, () => false);
