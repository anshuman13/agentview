import { isAllDay } from './load';
import { listOf, live, seriesTitle, type Meeting } from './wiki';
import type { ItemRow } from './sync';

const HOUR = 3600_000;
const WEEK = 7 * 24 * HOUR;
const MAX_HOURS = 8;

export type SeriesValue = { key: string; title: string; latest: Meeting; count: number; hours: number; decisions: number; actions: number; recentHours: number; quiet: boolean };

// Recurring series (a title seen at least twice) over the last 8 weeks: hours, decisions and my actions (open or done).
// A series is quiet when its meetings of the last 4 weeks brought no decision and no action of mine; quiet ones come first, most recent hours first.
export function seriesAudit(meetings: Meeting[], items: ItemRow[], now: number): SeriesValue[] {
  const mine = new Map<string, number>();
  for (const r of items) {
    if (r.deleted || r.meeting_id == null || (r.status !== 'open' && r.status !== 'done')) continue;
    const k = `${r.profile}:${r.meeting_id}`;
    mine.set(k, (mine.get(k) ?? 0) + 1);
  }
  const rows = new Map<string, SeriesValue & { recentValue: number }>();
  for (const m of live(meetings)) {
    if (m.starts_at == null || m.ends_at == null || m.ends_at <= m.starts_at || m.starts_at > now || m.starts_at < now - 8 * WEEK || isAllDay(m)) continue;
    const title = seriesTitle(m.title);
    if (!title) continue;
    const key = `${m.profile}:${title}`;
    const row = rows.get(key) ?? { key, title: '', latest: m, count: 0, hours: 0, decisions: 0, actions: 0, recentHours: 0, quiet: false, recentValue: 0 };
    const hours = Math.min((Math.min(m.ends_at, now) - m.starts_at) / HOUR, MAX_HOURS);
    const decisions = listOf(m.decisions).length;
    const actions = mine.get(`${m.profile}:${m.id}`) ?? 0;
    Object.assign(row, { count: row.count + 1, hours: row.hours + hours, decisions: row.decisions + decisions, actions: row.actions + actions });
    if (m.starts_at >= now - 4 * WEEK) {
      row.recentHours += hours;
      row.recentValue += decisions + actions;
    }
    if (m.starts_at >= row.latest.starts_at!) row.latest = m;
    rows.set(key, row);
  }
  return [...rows.values()]
    .filter((r) => r.count > 1)
    .map(({ recentValue, ...r }) => ({ ...r, title: r.latest.title ?? r.title, quiet: r.recentHours > 0 && recentValue === 0 }))
    .sort((a, b) => Number(b.quiet) - Number(a.quiet) || (a.quiet ? b.recentHours - a.recentHours : b.hours - a.hours) || a.title.localeCompare(b.title));
}
