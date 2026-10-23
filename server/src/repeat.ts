import type { Repeat } from '../../shared/protocol.js';

const UNIT: Record<string, number> = { m: 60_000, min: 60_000, h: 3_600_000 };

export const USAGE = 'Usage: /loop 10m <prompt>, /loop until 07:00 <prompt>, /loop 30m until 07:00 <prompt>, /loop off';

// /loop <prompt> alone is refused: a loop needs an interval or an end time.
export function parseLoop(text: string, now = Date.now()): Repeat | 'off' | 'usage' | null {
  const m = /^\/loop\b([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const rest = m[1].trim();
  if (/^(off|stop)$/i.test(rest)) return 'off';
  const p = /^(?:(?:every\s+)?(\d+)\s*(m|min|h)\s+)?(?:until\s+(\d{1,2}):(\d{2})\s+)?([\s\S]+)$/i.exec(rest);
  if (!p || (!p[1] && !p[3])) return 'usage';
  const every = p[1] ? Number(p[1]) * UNIT[p[2].toLowerCase()] : 0;
  const until = p[3] ? nextClock(Number(p[3]), Number(p[4]), now) : null;
  return { prompt: p[5].trim(), every, until, round: 0, nextAt: null };
}

export function nextClock(hours: number, minutes: number, now: number) {
  const d = new Date(now);
  d.setHours(hours, minutes, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);

// "You've hit your session limit · resets 1:50am (Europe/Oslo)" gives the time a loop may go on, plus a minute.
export function limitReset(text: string, now = Date.now()): number | null {
  const m = /\blimit\b.*?\bresets?\b(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/is.exec(text);
  if (!m || (!m[2] && !m[3]) || Number(m[1]) > 23) return null;
  const meridiem = m[3]?.toLowerCase();
  const hours = meridiem ? (Number(m[1]) % 12) + (meridiem === 'pm' ? 12 : 0) : Number(m[1]);
  return nextClock(hours, Number(m[2] ?? 0), now) + 60_000;
}

const span = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`);

export const describeLoop = (r: Repeat) => `${r.every ? `every ${span(r.every)}` : 'back to back'}${r.until ? ` until ${clock(r.until)}` : ''}`;
