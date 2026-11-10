import { useSyncExternalStore } from 'react';

const NARROW = '(max-width: 900px)';

const subscribe = (cb: () => void) => {
  const mq = matchMedia(NARROW);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

export const useNarrow = () => useSyncExternalStore(subscribe, () => matchMedia(NARROW).matches, () => false);
