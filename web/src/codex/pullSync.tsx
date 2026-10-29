import { useRef } from 'react';
import { useAssistantStore } from './data';
import { Icon } from '../ui/Icon';
import { usePullRefresh } from './usePullRefresh';

// Pull down from the top of a page's scroller on the phone to sync: put the indicator before the scroller and give it the ref.
export function usePullSync() {
  const store = useAssistantStore();
  const ref = useRef<HTMLDivElement>(null);
  const ptr = usePullRefresh(ref, () => store.syncNow(), true);
  return { ref, indicator: <div className="as-ptr" ref={ptr} aria-hidden><Icon name="refresh" /></div> };
}
