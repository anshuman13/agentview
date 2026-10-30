import { pad, WEEKDAYS } from './dates';
import { atTime } from './engine';
import type { ItemRow } from './sync';

const RULE_RE = /\bevery\s+(day|weekday|week|month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?|(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?)\b(?:\s+(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)?\b)?/i;

type Rule = { kind: 'day' | 'weekday' | 'dow' | 'month'; dow: number; dom: number; h: number; m: number };

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

function ruleLine(r: Rule) {
  const t = `${pad(r.h)}:${pad(r.m)}`;
  if (r.kind === 'dow') return `Repeats: every ${WEEKDAYS[r.dow]} ${t}`;
  if (r.kind === 'month') return `Repeats: every month on the ${ord(r.dom)} ${t}`;
  return `Repeats: every ${r.kind} ${t}`;
}

function occursOn(r: Rule, d: Date) {
  if (r.kind === 'day') return true;
  if (r.kind === 'weekday') return d.getDay() >= 1 && d.getDay() <= 5;
  return r.kind === 'dow' && d.getDay() === r.dow;
}

// The first matching time strictly after `after`. A month day past the month's end falls on its last day.
function nextAfter(r: Rule, after: number) {
  const base = new Date(after);
  for (let k = 0; k < 400; k++) {
    const t = r.kind === 'month'
      ? new Date(base.getFullYear(), base.getMonth() + k, Math.min(r.dom, new Date(base.getFullYear(), base.getMonth() + k + 1, 0).getDate()), r.h, r.m)
      : new Date(base.getFullYear(), base.getMonth(), base.getDate() + k, r.h, r.m);
    if ((r.kind === 'month' || occursOn(r, t)) && t.getTime() > after) return t.getTime();
  }
  return null;
}

function read(m: RegExpExecArray, now: Date): Rule | null {
  const w = m[1].toLowerCase();
  let h = m[4] ? Number(m[4]) : 9;
  const mi = m[5] ? Number(m[5]) : 0;
  const ap = m[6]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  const r: Rule = { kind: 'day', dow: 0, dom: 1, h, m: mi };
  if (w === 'day' || w === 'weekday') r.kind = w;
  else if (w === 'week') {
    r.dow = new Date(nextAfter(r, now.getTime()) ?? now).getDay();
    r.kind = 'dow';
  } else if (m[2]) {
    r.kind = 'month';
    r.dom = Number(m[2]);
    if (r.dom < 1 || r.dom > 31) return null;
  } else {
    r.kind = 'dow';
    r.dow = WEEKDAYS.findIndex((n) => n.startsWith(m[3].toLowerCase().slice(0, 3)));
  }
  return r;
}

type Repeat = { title: string; text: string; at: number };

// "Water plants every monday 9" gives the title, the "Repeats:" line and the first due time.
export function parseRepeat(typed: string, now = new Date()): Repeat | null {
  const m = RULE_RE.exec(typed);
  const r = m && read(m, now);
  if (!m || !r) return null;
  const title = (typed.slice(0, m.index) + ' ' + typed.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim();
  const at = nextAfter(r, now.getTime());
  return title && at != null ? { title, text: ruleLine(r), at } : null;
}

export const isRepeat = (text: string | null) => !!text && /^\s*Repeats:/.test(text);

export type Cadence = 'never' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

// Adds, replaces or removes (rule null) the "Repeats:" first line of a task's text.
export function withRule(text: string, rule: string | null) {
  const rest = isRepeat(text) ? text.replace(/^[^\n]*\n?/, '') : text;
  return rule ? (rest ? `${rule}\n${rest}` : rule) : rest;
}

// The rule line for a cadence, timed and anchored on the due time (or `now` without one).
export function cadenceLine(c: Exclude<Cadence, 'never' | 'custom'>, at: number | null, now = Date.now()) {
  const d = new Date(at ?? now);
  const kind = { daily: 'day', weekdays: 'weekday', weekly: 'dow', monthly: 'month' }[c] as Rule['kind'];
  return ruleLine({ kind, dow: d.getDay(), dom: d.getDate(), h: at == null ? 9 : d.getHours(), m: at == null ? 0 : d.getMinutes() });
}

// Which choice the text's rule is, given the due time; a rule that is none of them is custom.
export function cadenceOf(text: string | null, at: number | null): Cadence {
  if (!text || !isRepeat(text)) return 'never';
  const m = RULE_RE.exec(text.split('\n')[0]);
  const r = m && read(m, new Date(at ?? Date.now()));
  if (!r) return 'custom';
  if (r.kind === 'day') return 'daily';
  if (r.kind === 'weekday') return 'weekdays';
  if (at == null) return r.kind === 'dow' ? 'weekly' : 'monthly';
  const d = new Date(at);
  if (r.kind === 'dow') return r.dow === d.getDay() ? 'weekly' : 'custom';
  return r.dom === d.getDate() ? 'monthly' : 'custom';
}

// The row to create when a repeating task is done, or null. Skips a copy that already exists.
export function nextRepeat(row: ItemRow, now: number, rows: ItemRow[] = []): { title: string; text: string; at: number } | null {
  if (!row.text || !isRepeat(row.text)) return null;
  const m = RULE_RE.exec(row.text.split('\n')[0]);
  const r = m && read(m, new Date(now));
  if (!r) return null;
  const at = nextAfter(r, Math.max(atTime(row.at) ?? now, now));
  if (at == null) return null;
  if (rows.some((x) => x.profile === row.profile && x.id !== row.id && !x.deleted && x.status === 'open' && x.title === row.title && x.text === row.text && atTime(x.at) === at)) return null;
  return { title: row.title ?? '', text: row.text, at };
}
