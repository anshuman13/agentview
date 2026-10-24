import { MAX_GOAL_ROUNDS, type Repeat } from '../../../shared/protocol.js';

const UNIT: Record<string, number> = { m: 60_000, min: 60_000, h: 3_600_000 };

export const USAGE = 'Usage: /loop 10m <prompt>, /loop until 07:00 <prompt>, /loop 30m until 07:00 <prompt>, /loop at 01:50 <prompt> (once), /loop off';

export const GOAL_USAGE = 'Usage: /goal <condition>, /goal off';

export const goalPrompt = (goal: string) => `Check whether this goal is met: ${goal}. Reply GOAL MET when it is, otherwise keep working on it.`;

// /goal <condition> checks the condition whenever Claude goes idle, until it reports GOAL MET or the rounds run out.
export function parseGoal(text: string): Repeat | 'off' | 'usage' | null {
  const m = /^\/goal\b([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const goal = m[1].trim();
  if (/^(off|stop)$/i.test(goal)) return 'off';
  if (!goal) return 'usage';
  return { prompt: goalPrompt(goal), every: 0, until: null, round: 0, nextAt: null, goal };
}

export const goalMet = (text: string) => /\bGOAL MET\b/.test(text);

export const roundWord = (r: Repeat) => (r.goal ? 'Goal check' : 'Loop round');

export const offCommand = (r: Repeat) => (r.goal ? '/goal off' : '/loop off');

// /loop <prompt> alone is refused: a loop needs an interval or an end time.
export function parseLoop(text: string, now = Date.now()): Repeat | 'off' | 'usage' | null {
  const m = /^\/loop\b([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const rest = m[1].trim();
  if (/^(off|stop)$/i.test(rest)) return 'off';
  const p = /^(?:(?:every\s+)?(\d+)\s*(m|min|h)\s+)?(?:until\s+(\d{1,2}):(\d{2})\s+)?(?:at\s+(\d{1,2}):(\d{2})\s+)?([\s\S]+)$/i.exec(rest);
  if (!p || (!p[1] && !p[3] && !p[5])) return 'usage';
  const prompt = p[7].trim();
  if (p[1] && Number(p[1]) * UNIT[p[2].toLowerCase()] > MAX_EVERY) return 'usage';
  if (p[5]) {
    const at = nextClock(Number(p[5]), Number(p[6]), now);
    return { prompt, every: 0, until: at + 1000, round: 0, nextAt: at };
  }
  const every = p[1] ? Number(p[1]) * UNIT[p[2].toLowerCase()] : 0;
  const until = p[3] ? nextClock(Number(p[3]), Number(p[4]), now) : null;
  return { prompt, every, until, round: 0, nextAt: null };
}

// /loop at HH:MM runs the prompt once: the loop ends a second after it fires.
export const once = (r: Repeat) => !r.every && r.until !== null && r.nextAt !== null && r.until - r.nextAt <= 1000;

const MAX_EVERY = 7 * 24 * 3_600_000;
const MAX_TIMER = 2 ** 31 - 1;

// Node clamps setTimeout at 24.8 days and fires at once past it; longer waits go in chunks.
export function after(at: number, fn: () => void): NodeJS.Timeout {
  const left = at - Date.now();
  return setTimeout(() => (Date.now() >= at ? fn() : void after(at, fn)), Math.min(Math.max(0, left), MAX_TIMER));
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

export const describeLoop = (r: Repeat) =>
  r.goal ? `checked whenever Claude goes idle until "${r.goal}" is met, up to ${MAX_GOAL_ROUNDS} checks` : once(r) ? `once at ${clock(r.nextAt!)}` : `${r.every ? `every ${span(r.every)}` : 'back to back'}${r.until ? ` until ${clock(r.until)}` : ''}`;
