import { useEffect, useMemo } from 'react';
import { tauriInvoke } from '../runtime/tauri';
import { badgeArg, createBadgeSender } from '../runtime/launcherBadge';
import { useCounts } from '../store/counts';

function useLauncherBadge() {
  const count = badgeArg(useCounts().needsYou);
  const send = useMemo(() => createBadgeSender(tauriInvoke()), []);
  useEffect(() => send(count), [send, count]);
  useEffect(() => {
    const shown = () => document.visibilityState === 'visible' && send(count, true);
    document.addEventListener('visibilitychange', shown);
    return () => document.removeEventListener('visibilitychange', shown);
  }, [send, count]);
}

export function BadgeMount() {
  useLauncherBadge();
  return null;
}
