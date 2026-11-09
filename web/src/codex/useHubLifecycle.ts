import { useEffect, useState, type RefObject } from 'react';
import { errorText } from './data/tasks/engine';
import type { AssistantStore } from './data/store';

const CALENDAR_FRESH = 15 * 60_000;
let lastCalendar = 0;

// Unlocks the store whenever the app comes back into view, and once it is ready imports the calendar unless it or the
// hub did within the last minutes. Returns the calendar error, if any, and a retry for it.
export function useHubLifecycle(store: AssistantStore, ready: boolean, root: RefObject<HTMLElement | null>) {
  const [calError, setCalError] = useState('');
  useEffect(() => {
    const shown = () => document.visibilityState === 'visible' && root.current?.offsetParent != null;
    const retry = () => { if (shown()) store.unlock(); };
    retry();
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('assistant:shown', retry);
    return () => { document.removeEventListener('visibilitychange', retry); window.removeEventListener('assistant:shown', retry); };
  }, [store, root]);
  useEffect(() => {
    if (!ready) return;
    const run = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCalendar < CALENDAR_FRESH) return;
      store.syncCalendar(CALENDAR_FRESH).then(() => { lastCalendar = Date.now(); setCalError(''); }, (err) => setCalError(errorText(err)));
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [store, ready]);
  const retryCalendar = () => store.syncCalendar().then(() => setCalError(''), (err) => setCalError(errorText(err)));
  return { calError, retryCalendar };
}
