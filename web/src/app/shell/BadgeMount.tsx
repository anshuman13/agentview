import { useEffect, useMemo } from 'react';
import { tauriInvoke } from '../../codex/data/local';
import { useNeedsYou } from '../../codex/NeedsYou';
import { useMinute, useSplit } from '../../codex/split';
import { badgeArg, badgeCount, createBadgeSender } from '../runtime/launcherBadge';

function useLauncherBadge() {
  const now = useMinute();
  const { rows } = useNeedsYou(useSplit(), now);
  const count = badgeArg(badgeCount(rows));
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
