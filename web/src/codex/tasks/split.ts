import { useEffect, useMemo, useState } from 'react';
import { isBlock } from '../../../../shared/util';
import { useAssistantData } from '../data';
import { live } from '../data/wiki/wiki';
import { split } from '../data/tasks/engine';
import { useView } from '../view';
import { dayEnd, dayStart } from '../data/dates';

// Re-renders every minute and when the app comes back to the front, so due tasks move into Today; returns the time of the last tick.
export function useMinute() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const bump = () => setNow(Date.now());
    const shown = () => document.visibilityState === 'visible' && bump();
    const t = setInterval(shown, 60000);
    document.addEventListener('visibilitychange', shown);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', shown); };
  }, []);
  return now;
}

// useSplit shares one result per items array, filter and minute.
type Split = ReturnType<typeof split>;
const splits = new WeakMap<object, { minute: number; byFilter: Map<string, Split> }>();
export function sharedSplit(items: Parameters<typeof split>[0], filter: Parameters<typeof split>[1], now: number): Split {
  const minute = Math.floor(now / 60000);
  let hit = splits.get(items);
  if (!hit || hit.minute !== minute) splits.set(items, hit = { minute, byFilter: new Map() });
  let result = hit.byFilter.get(filter);
  if (!result) hit.byFilter.set(filter, result = split(items, filter, now));
  return result;
}

export function useSplit() {
  const snap = useAssistantData();
  const { filter } = useView();
  const minute = useMinute();
  return useMemo(() => {
    const now = Date.now();
    const all = live(snap.meetings).filter((m) => m.starts_at != null && (filter === 'all' || m.profile === filter) && !isBlock(m.id));
    const ahead = all.filter((m) => (m.ends_at ?? m.starts_at!) > now).sort((a, b) => a.starts_at! - b.starts_at!);
    const endOfDay = dayEnd(now);
    const today = ahead.filter((m) => m.starts_at! < endOfDay);
    const next = today[0];
    const startOfDay = dayStart(now);
    return {
      ...sharedSplit(snap.items, filter, now), next, endOfDay,
      meetingsToday: all.filter((m) => m.starts_at! >= startOfDay && m.starts_at! < endOfDay).sort((a, b) => a.starts_at! - b.starts_at!),
      nextLater: today.find((m) => m !== next && m.starts_at! > now) ?? ahead.find((m) => m.starts_at! >= endOfDay),
    };
  }, [snap.items, snap.meetings, filter, minute]);
}
