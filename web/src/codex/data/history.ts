import { clock } from '../time';
import { dayLabel, dayStart } from './dates';
import { atTime } from './engine';
import { parseTimes, type ItemRow } from './sync';

type HistoryEntry = { field: 'status' | 'at' | 'assignee'; title: string; at: number };

const noun = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const title = (r: ItemRow, field: HistoryEntry['field']) => {
  if (field === 'status') return `Status: ${noun(r.status ?? '')}`;
  if (field === 'assignee') return r.assignee ? `Assigned to ${r.assignee}` : 'Unassigned';
  const due = r.at ? atTime(r.at) : null;
  if (due == null) return 'Due date cleared';
  const d = new Date(due);
  return `Due: ${dayLabel(due, true)}${d.getHours() || d.getMinutes() ? ` ${clock(due)}` : ''}`;
};

export function historyOf(r: ItemRow): HistoryEntry[] {
  const times = parseTimes(r.field_times);
  return (['status', 'at', 'assignee'] as const)
    .flatMap((field) => { const at = times[field]; return typeof at === 'number' && at > 0 && Number.isFinite(at) ? [{ field, title: title(r, field), at }] : []; })
    .sort((a, b) => b.at - a.at);
}

export function historyTime(at: number, now = Date.now()) {
  const days = (dayStart(now) - dayStart(at)) / 86400000;
  if (days < 1) return clock(at);
  return days < 7 ? new Date(at).toLocaleDateString([], { weekday: 'short' }) : dayLabel(at);
}
