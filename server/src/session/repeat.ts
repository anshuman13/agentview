import { MAX_GOAL_ROUNDS, type Repeat, type SessionInfo } from '../../../shared/protocol.js';
import { clock, span } from '../../../shared/util.js';
import type { Cron } from '../agent/types.js';

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
// A one-shot loop that has not run yet waits for its round even past until, when Claude was busy or the round was deferred.
const unrun = (r: Repeat) => once(r) && r.round === 0;

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

export const describeLoop = (r: Repeat) =>
  r.goal ? `checked whenever Claude goes idle until "${r.goal}" is met, up to ${MAX_GOAL_ROUNDS} checks` : once(r) ? `once at ${clock(r.nextAt!)}` : `${r.every ? `every ${span(r.every)}` : 'back to back'}${r.until ? ` until ${clock(r.until)}` : ''}`;

// A loop goes on after Stop or a CLI exit, with time to type /loop off first.
const REPEAT_GRACE_MS = 2 * 60_000;
const MIN_ROUND_MS = 60_000;

export interface RepeatHost {
  repeat(): Repeat | null;
  running(): boolean;
  closed(): boolean;
  setSession(patch: Partial<SessionInfo>): void;
  system(text: string): void;
  sendPrompt(text: string): void;
}

export class RepeatController {
  private timer: NodeJS.Timeout | undefined;
  private roundAt = 0;
  private held = false;
  due = false;

  constructor(private host: RepeatHost) {}

  command(text: string, echo: () => void) {
    const goal = text.trim().startsWith('/goal');
    const parsed = goal ? parseGoal(text) : parseLoop(text);
    if (!parsed) return false;
    echo();
    const word = goal ? 'Goal' : 'Loop';
    if (parsed === 'usage') this.host.system(goal ? GOAL_USAGE : USAGE);
    else if (parsed === 'off') this.set(null, this.host.repeat() ? `${word} off` : `No ${word.toLowerCase()} is running`);
    else this.set(parsed);
    return true;
  }

  set(r: Repeat | null, note?: string) {
    clearTimeout(this.timer);
    this.due = false;
    this.host.setSession({ repeat: r });
    if (!r) return this.host.system(note ?? 'Loop off');
    this.host.system(`${r.goal ? 'Goal' : 'Loop'} on, ${describeLoop(r)}`);
    if (r.nextAt && r.nextAt > Date.now()) this.arm();
    else this.fire();
  }

  stop() {
    clearTimeout(this.timer);
  }

  // A back to back loop never goes idle, so a pending restart holds it; the restarted server resumes it.
  hold() {
    this.held = true;
    clearTimeout(this.timer);
  }

  resume(r: Repeat) {
    this.host.setSession({ repeat: r });
    this.host.system(`AgentView restarted, the ${r.goal ? 'goal' : 'loop'} continues ${describeLoop(r)}`);
    if (!r.nextAt || r.nextAt <= Date.now()) this.fire();
    else this.arm();
  }

  fire() {
    const r = this.host.repeat();
    if (!r || this.held) return;
    if (r.until && Date.now() >= r.until && !unrun(r)) return this.set(null, `Loop finished at ${clock(r.until)} after ${r.round} ${r.round === 1 ? 'round' : 'rounds'}`);
    if (r.goal && r.round >= MAX_GOAL_ROUNDS) return this.set(null, `Goal not met after ${r.round} checks: ${r.goal}`);
    if (this.host.running()) {
      this.due = true;
      return;
    }
    // A round that ended within a minute of starting did no work; wait before the next one instead of spinning.
    if (Date.now() - this.roundAt < MIN_ROUND_MS) return this.defer(this.roundAt + REPEAT_GRACE_MS);
    this.due = false;
    this.roundAt = Date.now();
    const round = r.round + 1;
    this.host.setSession({ repeat: { ...r, round, nextAt: r.every ? Date.now() + r.every : null } });
    this.arm();
    this.host.system(`${roundWord(r)} ${round}`);
    this.host.sendPrompt(r.prompt);
  }

  // A round that failed waits before the next one, so a loop never spins on an error.
  defer(until = Date.now() + REPEAT_GRACE_MS, why?: string) {
    const r = this.host.repeat();
    if (!r) return;
    this.due = false;
    const nextAt = Math.max(r.nextAt ?? 0, until);
    this.host.setSession({ repeat: { ...r, nextAt } });
    this.arm();
    this.host.system(`${why ?? roundWord(r)} ${r.round + 1} at ${clock(nextAt)}, ${offCommand(r)} to end it`);
  }

  private arm() {
    clearTimeout(this.timer);
    const r = this.host.repeat();
    const at = Math.min(r?.nextAt ?? Infinity, r && unrun(r) ? Infinity : (r?.until ?? Infinity));
    // The driver reports its exit after close(); a closed chat must not wake up again.
    if (!r || at === Infinity || this.host.closed()) return;
    this.timer = after(at, () => this.fire());
  }
}

export const restorePrompt = (crons: Cron[]) =>
  `AgentView restarted. It is now ${new Date().toString()}. Your scheduled jobs are below. First run CronList: a job that is still listed survived the restart but will not fire, so CronDelete it. Then CronCreate each job below once, with the same cron, prompt and recurring flag, so exactly one copy exists. If a one-shot job's time has already passed, run its prompt now instead. Reply in one line.\n\n${JSON.stringify(crons.map(({ schedule, prompt, recurring }) => ({ cron: schedule, prompt, recurring })), null, 2)}`;
