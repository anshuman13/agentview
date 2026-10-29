import { useEffect, useMemo, useState } from 'react';
import { useAssistantData, useCodex } from './data';
import { live, type Meeting } from './data/wiki';
import { split } from './data/engine';
import { useView } from './view';

// Re-renders every minute and when the app comes back to the front, so due tasks move into Today.
export function useMinute() {
  const [minute, tick] = useState(0);
  useEffect(() => {
    const bump = () => tick((n) => n + 1);
    const t = setInterval(bump, 60000);
    const shown = () => document.visibilityState === 'visible' && bump();
    document.addEventListener('visibilitychange', shown);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', shown); };
  }, []);
  return minute;
}

export function useSplit() {
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const { filter } = useView();
  const minute = useMinute();
  return useMemo(() => {
    const now = Date.now();
    const all = live(meetings).filter((m) => m.starts_at != null && (filter === 'all' || m.profile === filter));
    const ahead = all.filter((m) => (m.ends_at ?? m.starts_at!) > now).sort((a, b) => a.starts_at! - b.starts_at!);
    const endOfDay = new Date(now).setHours(24, 0, 0, 0);
    const today = ahead.filter((m) => m.starts_at! < endOfDay);
    const next = today[0];
    const startOfDay = new Date(now).setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(now).setHours(48, 0, 0, 0);
    const byStart = (a: Meeting, b: Meeting) => a.starts_at! - b.starts_at!;
    // Open actions from earlier meetings with the same title.
    const carried = next ? snap.items.filter((r) => !r.deleted && r.status === 'open' && r.meeting_id && r.profile === next.profile && r.meeting_id !== next.id
      && all.some((m) => m.id === r.meeting_id && m.profile === next.profile && m.title === next.title && m.starts_at! < next.starts_at!)).length : 0;
    return {
      ...split(snap.items, filter, now), next, then: today[1], carried, endOfDay, endOfTomorrow,
      meetingsToday: all.filter((m) => m.starts_at! >= startOfDay && m.starts_at! < endOfDay).sort(byStart),
      meetingsTomorrow: all.filter((m) => m.starts_at! >= endOfDay && m.starts_at! < endOfTomorrow).sort(byStart),
      nextLater: today.find((m) => m !== next && m.starts_at! > now) ?? ahead.find((m) => m.starts_at! >= endOfDay),
    };
  }, [snap.items, meetings, filter, minute]);
}
