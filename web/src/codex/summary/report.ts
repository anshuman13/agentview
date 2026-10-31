import { atTime, statusTime } from '../data/engine';
import { dayLabel, dayStart, weekStart } from '../data/dates';
import type { ItemRow } from '../data/sync';

export type DateRange = 'today' | 'week' | 'last' | 'month';
export type StatusFilter = 'all' | 'done' | 'open';
export type Line = { row: ItemRow; at: number; text: string };

const span = (range: DateRange, now: number): [number, number] => {
  const d = new Date(now);
  const week = weekStart(now);
  if (range === 'today') return [dayStart(now), dayStart(now) + 86400000];
  if (range === 'last') return [week - 7 * 86400000, week];
  if (range === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
  return [week, week + 7 * 86400000];
};

export function buildReport(items: ItemRow[], range: DateRange, status: StatusFilter, now = Date.now()) {
  const [from, to] = span(range, now);
  const done: Line[] = [];
  const open: Line[] = [];
  for (const r of items) {
    if (r.deleted || !r.title) continue;
    if (r.status === 'done') {
      const t = statusTime(r);
      if (t >= from && t < to) done.push({ row: r, at: t, text: r.title });
    } else if (r.status === 'open') {
      const t = atTime(r.at);
      if (t != null && t < to) open.push({ row: r, at: t, text: r.title });
    }
  }
  done.sort((a, b) => a.at - b.at);
  open.sort((a, b) => a.at - b.at);
  const title = range === 'today' ? dayLabel(from) : `${dayLabel(from)} - ${dayLabel(to - 1)}`;
  const groups = [
    { name: 'Completed', lines: status === 'open' ? [] : done },
    { name: 'Not completed', lines: status === 'done' ? [] : open },
  ].filter((g) => g.lines.length);
  const line = (l: Line) => `- [${dayLabel(l.at)}] ${l.text}`;
  const markdown = [`## ${title}`, ...groups.flatMap((g) => ['', `### ${g.name}`, ...g.lines.map(line)])].join('\n');
  return { title, groups, markdown };
}
