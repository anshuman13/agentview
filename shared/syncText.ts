import { clock } from './util';

// When the shown Codex data last synced: the time today, "yesterday", the weekday within a week, else the date.
export function syncedAt(last: number, now: number) {
  if (!last) return 'Never synced';
  const d = new Date(last);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(last).setHours(0, 0, 0, 0)) / 86_400_000);
  const when = days === 0 ? clock(last) : days === 1 ? `yesterday ${clock(last)}` : days < 7 ? `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${clock(last)}` : `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`;
  return `Last synced ${when}`;
}
