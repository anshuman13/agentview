import { MAX_GOAL_ROUNDS, type ChatRun, type Repeat, type SessionInfo } from '../../../shared/protocol.js';
import { clock, span } from '../../../shared/util.js';
import type { Cron } from '../agent/types.js';

const UNIT: Record<string, number> = { m: 60_000, min: 60_000, h: 3_600_000 };

const USAGE = 'Usage: /loop 10m <prompt>, /loop until 07:00 <prompt>, /loop 30m until 07:00 <prompt>, /loop at 01:50 <prompt> (once), /loop off';

const GOAL_USAGE = 'Usage: /goal <condition>, /goal every 1h <condition> (every 30m or longer), /goal off';

const DAY = 24 * 3_600_000;
const STANDING_MS = 28 * DAY;
const REPORT_MS = 7 * DAY;
const MIN_STANDING_EVERY = 30 * 60_000;
const STANDING_ENDED = 'ran for 28 days, start it again to continue';

const goalPrompt = (goal: string) => `Check whether this goal is met: ${goal}. Reply GOAL MET when it is, otherwise keep working on it.`;

const standingPrompt = (goal: string) => `Standing goal: ${goal}. Read where things stand. Do whatever moves the goal forward without the user. Do not do anything irreversible or outward-facing (push, deploy, delete, send a message to someone): ask it as a question instead. Reply GOAL MET when the goal is met.`;

const reportPrompt = (goal: string) => `Standing goal: ${goal}. Write a short weekly report: what moved, what is blocked, what is next, in at most 8 lines. Do not change anything this round.`;

export const standing = (r: Repeat) => Boolean(r.goal && r.every);

const reportDue = (r: Repeat, now = Date.now()) => standing(r) && r.reportAt !== undefined && now >= r.reportAt;

// /goal <condition> checks the condition whenever Claude goes idle, until it reports GOAL MET or the rounds run out.
// /goal every 1h <condition> is a standing goal: one heartbeat per interval for up to 28 days.
export function parseGoal(text: string, now = Date.now()): Repeat | 'off' | 'usage' | null {
  const m = /^\/goal\b([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const goal = m[1].trim();
  if (/^(off|stop)$/i.test(goal)) return 'off';
  if (!goal) return 'usage';
  const s = /^every\s+(\d+)\s*(m|min|h)\b\s*([\s\S]*)$/i.exec(goal);
  if (s) {
    const every = Number(s[1]) * UNIT[s[2].toLowerCase()];
    if (every < MIN_STANDING_EVERY || every > MAX_EVERY || !s[3].trim()) return 'usage';
    return { prompt: standingPrompt(s[3].trim()), every, until: now + STANDING_MS, round: 0, nextAt: null, goal: s[3].trim(), reportAt: now + REPORT_MS };
  }
  return { prompt: goalPrompt(goal), every: 0, until: null, round: 0, nextAt: null, goal };
}

export const ROUND_INSTRUCTION = 'Finish your reply with one last line: ROUND: <done|progress|blocked|question|nothing> <one-line summary>. Use nothing when there was nothing to do this round.';

export const goalMet = (text: string) => /\bGOAL MET\b/.test(text);

const roundWord = (r: Repeat) => (r.goal ? 'Goal check' : 'Loop round');

const offCommand = (r: Repeat) => (r.goal ? '/goal off' : '/loop off');

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

export function fireTime(schedule: string, now = Date.now()) {
  const [m, h, dom, mon] = schedule.trim().split(/\s+/).slice(0, 4).map(Number);
  if ([m, h, dom, mon].some((n) => !Number.isInteger(n))) return null;
  const at = new Date(new Date(now).getFullYear(), mon - 1, dom, h, m);
  if (at.getTime() < now - 60_000) at.setFullYear(at.getFullYear() + 1);
  return at.getTime();
}

const describeLoop = (r: Repeat) =>
  standing(r) ? `standing goal every ${span(r.every)} for up to 28 days: "${r.goal}"` : r.goal ? `checked whenever Claude goes idle until "${r.goal}" is met, up to ${MAX_GOAL_ROUNDS} checks` : once(r) ? `once at ${clock(r.nextAt!)}` : `${r.every ? `every ${span(r.every)}` : 'back to back'}${r.until ? ` until ${clock(r.until)}` : ''}`;

// A loop goes on after Stop or a CLI exit, with time to type /loop off first.
const REPEAT_GRACE_MS = 2 * 60_000;
const MIN_ROUND_MS = 60_000;
const UNDO_MS = 60_000;

interface RepeatHost {
  repeat(): Repeat | null;
  running(): boolean;
  closed(): boolean;
  setSession(patch: Partial<SessionInfo>): void;
  system(text: string): void;
  startRun(r: Repeat): string;
  resumeRun(r: Repeat): string;
  endRun(id: string, why: string): void;
  reopenRun(id: string): void;
  patchRun(id: string, patch: Partial<Pick<ChatRun, 'state' | 'why' | 'round' | 'nextAt'>>): void;
  asking(): boolean;
  sendPrompt(text: string, auto: 'loop' | 'goal', round: number, report?: boolean): void;
}

export class RepeatController {
  private timer: NodeJS.Timeout | undefined;
  private roundAt = 0;
  private held = false;
  private stopped: { r: Repeat; at: number } | null = null;
  due = false;

  constructor(private host: RepeatHost) {}

  command(text: string, echo: () => void) {
    const goal = text.trim().startsWith('/goal');
    const parsed = goal ? parseGoal(text) : parseLoop(text);
    if (!parsed) return false;
    echo();
    const word = goal ? 'Goal' : 'Loop';
    if (parsed === 'usage') this.host.system(goal ? GOAL_USAGE : USAGE);
    else if (parsed === 'off') this.set(null, this.host.repeat() ? `${word} off` : `No ${word.toLowerCase()} is running`, 'you stopped it');
    else this.set(parsed);
    return true;
  }

  set(r: Repeat | null, note?: string, why = 'you stopped it') {
    clearTimeout(this.timer);
    this.due = false;
    const old = this.host.repeat();
    if (old?.runId && old.runId !== r?.runId) this.host.endRun(old.runId, r ? 'replaced by a new loop' : why);
    if (r && !r.runId) r = { ...r, runId: this.host.startRun(r) };
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
    r = { ...r, runId: this.host.resumeRun(r) };
    this.host.setSession({ repeat: r });
    this.host.system(`AgentView restarted, the ${r.goal ? 'goal' : 'loop'} ${r.paused ? 'stays paused' : `continues ${describeLoop(r)}`}`);
    if (!r.nextAt || r.nextAt <= Date.now()) this.fire();
    else this.arm();
  }

  pause() {
    const r = this.host.repeat();
    if (!r || r.paused) return;
    clearTimeout(this.timer);
    this.due = false;
    this.host.setSession({ repeat: { ...r, paused: true } });
    this.patchRun({ state: 'paused', why: 'you paused it' });
    this.host.system(`${r.goal ? 'Goal' : 'Loop'} paused`);
  }

  unpause() {
    const r = this.host.repeat();
    if (!r?.paused) return;
    this.host.setSession({ repeat: { ...r, paused: false } });
    this.patchRun({ state: 'running', why: '' });
    this.host.system(`${r.goal ? 'Goal' : 'Loop'} resumed`);
    if (!r.nextAt || r.nextAt <= Date.now()) this.fire();
    else this.arm();
  }

  runNow() {
    const r = this.host.repeat();
    if (!r || r.paused) return;
    if (this.host.running()) return this.host.system('Claude is busy, so there is no round to run now');
    this.roundAt = 0;
    this.fire();
  }

  stopRun() {
    const r = this.host.repeat();
    if (!r) return;
    this.stopped = { r, at: Date.now() };
    this.set(null, `${r.goal ? 'Goal' : 'Loop'} stopped`);
  }

  restore(runId: string) {
    const s = this.stopped;
    if (!s || s.r.runId !== runId || Date.now() - s.at > UNDO_MS || this.host.repeat()) return;
    this.stopped = null;
    this.host.reopenRun(runId);
    this.set({ ...s.r, paused: false });
  }

  // Whether the next fire() ends the run instead of starting a round.
  ends() {
    const r = this.host.repeat();
    return Boolean(r && this.finish(r));
  }

  private finish(r: Repeat) {
    if (r.until && Date.now() >= r.until && !unrun(r)) return standing(r) ? { note: `Goal ${STANDING_ENDED}: ${r.goal}`, why: STANDING_ENDED } : { note: `Loop finished at ${clock(r.until)} after ${r.round} ${r.round === 1 ? 'round' : 'rounds'}`, why: `finished at ${clock(r.until)}` };
    if (r.goal && !standing(r) && r.round >= MAX_GOAL_ROUNDS) return { note: `Goal not met after ${r.round} checks: ${r.goal}`, why: 'goal not met' };
    return null;
  }

  fire() {
    const r = this.host.repeat();
    if (!r || this.held || r.paused) return;
    const end = this.finish(r);
    if (end) return this.set(null, end.note, end.why);
    // A standing goal skips a heartbeat that finds Claude busy or waiting for the user; the next one is a full interval away.
    if (standing(r) && (this.host.running() || this.host.asking())) return this.skip(r);
    if (this.host.running()) {
      this.due = true;
      return;
    }
    // A round that ended within a minute of starting did no work; wait before the next one instead of spinning.
    if (!standing(r) && Date.now() - this.roundAt < MIN_ROUND_MS) return this.defer(this.roundAt + REPEAT_GRACE_MS);
    this.due = false;
    this.roundAt = Date.now();
    const round = r.round + 1;
    const nextAt = r.every ? Date.now() + r.every : null;
    const report = reportDue(r);
    const reportAt = report ? r.reportAt! + REPORT_MS * (Math.floor((Date.now() - r.reportAt!) / REPORT_MS) + 1) : r.reportAt;
    this.host.setSession({ repeat: { ...r, round, nextAt, reportAt } });
    this.patchRun({ state: 'running', why: '', round, nextAt });
    this.arm();
    this.host.sendPrompt(report ? reportPrompt(r.goal!) : r.prompt, r.goal ? 'goal' : 'loop', round, report);
  }

  private skip(r: Repeat) {
    const nextAt = Date.now() + r.every;
    this.host.setSession({ repeat: { ...r, nextAt } });
    this.patchRun({ nextAt });
    this.arm();
  }

  // A round that failed waits before the next one, so a loop never spins on an error.
  defer(until = Date.now() + REPEAT_GRACE_MS, why?: string, limit = false) {
    const r = this.host.repeat();
    if (!r) return;
    this.due = false;
    const nextAt = Math.max(r.nextAt ?? 0, until);
    this.host.setSession({ repeat: { ...r, nextAt } });
    this.patchRun({ nextAt, ...(limit && !r.paused && { state: 'paused', why: `usage limit until ${clock(nextAt)}` }) });
    this.arm();
    this.host.system(`${why ?? roundWord(r)} ${r.round + 1} at ${clock(nextAt)}, ${offCommand(r)} to end it`);
  }

  private patchRun(patch: Parameters<RepeatHost['patchRun']>[1]) {
    const id = this.host.repeat()?.runId;
    if (id) this.host.patchRun(id, patch);
  }

  private arm() {
    clearTimeout(this.timer);
    const r = this.host.repeat();
    const at = Math.min(r?.nextAt ?? Infinity, r && unrun(r) ? Infinity : (r?.until ?? Infinity));
    // The driver reports its exit after close(); a closed chat must not wake up again.
    if (!r || r.paused || at === Infinity || this.host.closed()) return;
    this.timer = after(at, () => this.fire());
  }
}

export const restorePrompt = (crons: Cron[], why: string) =>
  `${why}. It is now ${new Date().toString()}. Your scheduled jobs are below. First run CronList: a job that is still listed survived the restart but will not fire, so CronDelete it. Then CronCreate each job below once, with the same cron, prompt and recurring flag, so exactly one copy exists. If a one-shot job's time has already passed, run its prompt now instead. Reply in one line.\n\n${JSON.stringify(crons.map(({ schedule, prompt, recurring }) => ({ cron: schedule, prompt, recurring })), null, 2)}`;
