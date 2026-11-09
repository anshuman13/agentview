import { WEEKDAYS } from '../dates';
import type { Profile } from '../sync';

// Snooze targets and the dates, times and relative spans written inside a task's text.
const at = (base: Date, days: number, hour: number, minute = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour, minute).getTime();

export function nextNine(now = new Date(), profile?: Profile) {
  const skip = profile === 'work' ? [0, 0, 0, 0, 0, 2, 1][now.getDay()] : 0;
  return at(now, 1 + skip, 9);
}

export const SNOOZES: { label: string; at: (now: Date, profile?: Profile) => number }[] = [
  { label: 'In 1 hour', at: (now) => Math.ceil((now.getTime() + 3600_000) / 60_000) * 60_000 },
  { label: 'In 3 hours', at: (now) => now.getTime() + 3 * 3600_000 },
  { label: 'Tonight', at: (now) => (now.getHours() < 19 ? at(now, 0, 19) : at(now, 1, 19)) },
  { label: 'Tomorrow', at: (now, profile) => nextNine(now, profile) },
  { label: 'Next week', at: (now) => at(now, ((8 - now.getDay()) % 7) || 7, 9) },
];

const DATE_RE = /\b(today|tomorrow|tmrw|next week|end of (?:the )?week|eow|(?:on )?next (?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?|(?:on )?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?)\b/i;
// True when the text names a day or a relative time, not only a time of day.
export const hasDay = (text: string) => DATE_RE.test(text) || REL_RE.test(text);
const PART_RE = /\b(?:this |in the )?(morning|noon|lunch|afternoon|evening|tonight)\b/i;
const TIME_RE = /\b(?:at |kl\.? )?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)?\b(?!\s*(?:min|hour|hr|h\b|day|week|%))/i;
const REL_RE = /\b(?:in\s+(an?|one|half an?|\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|weeks?)\b(?:\s+from now)?|(an?|one|\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\s+(?:from now|later)\b)/i;
const PARTS: Record<string, number> = { morning: 9, noon: 12, lunch: 12, afternoon: 14, evening: 19, tonight: 19 };
const UNIT: Record<string, number> = { m: 60_000, h: 3600_000 };
const DAY_UNIT: Record<string, number> = { d: 1, w: 7 };

const clock = (t: RegExpExecArray, hint: number | null) => {
  let h = Number(t[1]);
  const minute = Number(t[2] ?? 0);
  if (h > 23 || minute > 59) return null;
  const ampm = t[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (!ampm && hint != null && hint >= 12 && h < 12) h += 12;
  return { h, minute };
};

export type Span = [number, number];
export type When = { at: number | null; spans: Span[] };

const span = (m: RegExpExecArray, offset = 0): Span => [offset + m.index, offset + m.index + m[0].length];

// Reads a date and time from the text: "in 1 hour", "2 hours from now", "tomorrow 9", "fri at 14:30", "this evening", "today".
// "today" without a time gives at = null, which keeps the task in Today.
export function parseWhen(text: string, now = new Date()): When | null {
  const r = REL_RE.exec(text);
  if (r) {
    const n = r[1] ?? r[3];
    const unit = (r[2] ?? r[4]).toLowerCase();
    const amount = /^half/i.test(n) ? 0.5 : /^(an?|one)$/i.test(n) ? 1 : Number(n);
    const key = unit === 'm' || unit.startsWith('min') ? 'm' : unit[0];
    const target = new Date(now);
    const spans = [span(r)];
    if (key in DAY_UNIT && Number.isInteger(amount * DAY_UNIT[key])) {
      target.setDate(target.getDate() + amount * DAY_UNIT[key]);
      const rest = text.slice(r.index + r[0].length);
      const t = TIME_RE.exec(rest);
      if (t && (t[2] || t[3] || /^(at|kl)/i.test(t[0])) && rest.slice(0, t.index).trim() === '') {
        const c = clock(t, null);
        if (!c) return null;
        spans.push(span(t, r.index + r[0].length));
        return { at: new Date(target.getFullYear(), target.getMonth(), target.getDate(), c.h, c.minute).getTime(), spans };
      }
    }
    else if (key in DAY_UNIT) target.setTime(now.getTime() + amount * DAY_UNIT[key] * 86_400_000);
    else target.setTime(now.getTime() + amount * UNIT[key]);
    return { at: Math.ceil(target.getTime() / 60_000) * 60_000, spans };
  }
  const d = DATE_RE.exec(text);
  const p = PART_RE.exec(text);
  let days: number | null = null;
  let eow = false;
  let hour: number | null = p ? PARTS[p[1].toLowerCase()] : null;
  if (d) {
    const w = d[1].toLowerCase().replace(/^on /, '');
    if (w === 'today') days = 0;
    else if (w === 'tomorrow' || w === 'tmrw') days = 1;
    else if (w === 'next week') days = ((8 - now.getDay()) % 7) || 7;
    else if (w === 'eow' || w.startsWith('end of')) {
      eow = true;
      days = now.getDay() === 0 ? -2 : 5 - now.getDay();
    } else if (w.startsWith('next ')) {
      const i = WEEKDAYS.findIndex((n) => n.startsWith(w.slice(5, 8)));
      days = (((8 - now.getDay()) % 7) || 7) + ((i + 6) % 7);
    }
    else {
      const i = WEEKDAYS.findIndex((n) => n.startsWith(w.slice(0, 3)));
      days = ((i - now.getDay() + 7) % 7) || 7;
    }
  }
  const anchor = d && p ? (d.index > p.index ? d : p) : d ?? p;
  const offset = anchor ? anchor.index + anchor[0].length : 0;
  const rest = text.slice(offset);
  const t = TIME_RE.exec(rest);
  const timed = t && (t[2] || t[3] || /^(at|kl)/i.test(t[0]) || (anchor && rest.slice(0, t.index).trim() === ''));
  if (!d && !p && !timed) return null;
  const spans: Span[] = [d, p].filter((m): m is RegExpExecArray => !!m).map((m) => span(m));
  let minute = 0;
  if (timed && t) {
    const c = clock(t, hour);
    if (!c) return null;
    hour = c.h;
    minute = c.minute;
    spans.push(span(t, offset));
  }
  if (eow) {
    hour ??= 17;
    if (at(now, days ?? 0, hour, minute) <= now.getTime()) days = (days ?? 0) + 7;
  }
  if (hour == null) {
    if (days === 0) return { at: null, spans };
    hour = 9;
  }
  if (days === null) days = at(now, 0, hour, minute) > now.getTime() ? 0 : 1;
  return { at: at(now, days, hour, minute), spans: spans.sort((a, b) => a[0] - b[0]) };
}

export function stripWhen(text: string, w: When | null) {
  let out = text;
  for (const [s, e] of [...(w?.spans ?? [])].sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + out.slice(e);
  return out.replace(/^\s*(?:add a task to|add a task|remind me to|reminder to)\s+/i, '').replace(/[\s,]*(?:and )?(?:set|add) a reminder\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
}
