import { nextClock } from '../../session/repeat.js';

// "You've hit your session limit · resets 1:50am (Europe/Oslo)" gives the time a loop may go on, plus a minute.
// Only a short one-line notice counts, so a normal reply that mentions a limit does not switch accounts.
export function limitReset(text: string, now = Date.now()): number | null {
  if (text.length > 160 || text.trim().includes('\n')) return null;
  const m = /^.{0,40}\blimit\b.*?\bresets?\b(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/is.exec(text);
  if (!m || (!m[2] && !m[3]) || Number(m[1]) > 23) return null;
  const meridiem = m[3]?.toLowerCase();
  const hours = meridiem ? (Number(m[1]) % 12) + (meridiem === 'pm' ? 12 : 0) : Number(m[1]);
  return nextClock(hours, Number(m[2] ?? 0), now) + 60_000;
}
