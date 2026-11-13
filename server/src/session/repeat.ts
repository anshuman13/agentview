import { MAX_GOAL_ROUNDS, type ChatRun, type PlanUsage, type Repeat, type RunEdit, type SessionInfo } from '../../../shared/protocol.js';
import { clock, nextClock, span } from '../../../shared/util.js';
import { GOAL_RAN_OUT, goalCapReached, goalNotMet, goalPlan, goalStoppedAt, nextRound, skipText } from '../../../shared/goalText.js';
import { MAX_EVERY, MIN_EVERY } from '../../../shared/goalForm.js';
import type { Cron } from '../agent/types.js';

const UNIT: Record<string, number> = { m: 60_000, min: 60_000, h: 3_600_000 };

const USAGE = 'Usage: /loop 10m <prompt>, /loop until 07:00 <prompt>, /loop 30m until 07:00 <prompt>, /loop at 01:50 <prompt> (once), /loop off';

const GOAL_USAGE = 'Usage: /goal [every 1h] [until 18:00] [cap 70%] [builds 5] <condition> (every 10m or longer), /goal off';

const MAX_BUILDS = 50;

const DAY = 24 * 3_600_000;
const STANDING_MS = 28 * DAY;
const REPORT_MS = 7 * DAY;
const FIVE_HOUR_LIMIT = 90;
const USAGE_SKIP = `5-hour usage over ${FIVE_HOUR_LIMIT}%`;
const GATE_RETRY_MS = 30 * 60_000;

const SEEN = 'You are the only one who sees the reply and the ROUND line.';

const goalPrompt = (goal: string) => `Check whether this goal is met: ${goal}. Reply GOAL MET when it is, otherwise keep working on it. Do not do anything irreversible or outward-facing (push, deploy, delete, send a message to someone): ask it as a question instead. ${SEEN}`;

const standingPrompt = (goal: string) => `Standing goal: ${goal}. Read where things stand. Do whatever moves the goal forward without the user. Do not do anything irreversible or outward-facing (push, deploy, delete, send a message to someone): ask it as a question instead. Reply GOAL MET when the goal is met. ${SEEN}`;

const reportPrompt = (goal: string) => `Standing goal: ${goal}. Write a short weekly report: what moved, what is blocked, what is next, in at most 8 lines, the first line being the headline. Do not change anything this round.`;

export const standing = (r: Repeat) => Boolean(r.goal && r.every);

const reportDue = (r: Repeat, now = Date.now()) => standing(r) && r.reportAt !== undefined && now >= r.reportAt;

// /goal [every 1h] [until 18:00] [cap 70%] [builds 5] <condition> checks the condition whenever the agent goes idle, until it reports GOAL MET or the rounds run out.
// With every it is a standing goal: one heartbeat per interval for up to 28 days. until sets an end time, cap a weekly usage limit, builds a limit on builds started.
export function parseGoal(text: string, now = Date.now()): Repeat | 'off' | 'usage' | null {
  const m = /^\/goal\b([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  let goal = m[1].trim();
  if (/^(off|stop)$/i.test(goal)) return 'off';
  if (!goal) return 'usage';
  const take = (re: RegExp) => {
    const t = re.exec(goal);
    if (t) goal = t[t.length - 1].trim();
    return t;
  };
  const e = take(/^every\s+(\d+)\s*(m|min|h)\b\s*([\s\S]*)$/i);
  const u = take(/^until\s+(\d{1,2}):(\d{2})\b\s*([\s\S]*)$/i);
  const c = take(/^cap\s+(\d+)%\s*([\s\S]*)$/i);
  const b = take(/^builds(?:\s+(\d+)\b|\s*$)\s*([\s\S]*)$/i);
  const every = e ? Number(e[1]) * UNIT[e[2].toLowerCase()] : 0;
  const capPct = c ? Number(c[1]) : 0;
  const maxBuilds = Number(b?.[1] ?? 0);
  if ((e || u || c || b) && !goal) return 'usage';
  if ((e && (every < MIN_EVERY || every > MAX_EVERY)) || (u && (Number(u[1]) > 23 || Number(u[2]) > 59)) || (c && (capPct < 1 || capPct > 100)) || (b && (maxBuilds < 1 || maxBuilds > MAX_BUILDS))) return 'usage';
  const extra = { ...(u && { endAt: nextClock(Number(u[1]), Number(u[2]), now) }), ...(c && { capPct }), ...(b && { maxBuilds, builds: [] }) };
  if (e) return { prompt: standingPrompt(goal), every, until: now + STANDING_MS, round: 0, nextAt: null, goal, reportAt: now + REPORT_MS, ...extra };
  return { prompt: goalPrompt(goal), every: 0, until: null, round: 0, nextAt: null, goal, ...extra };
}

// What the usage numbers say about a goal with a cap: end it at the weekly cap, skip a round while the 5-hour window is nearly full.
export function usageGate(r: Repeat, usage: PlanUsage | null, now = Date.now()): { note: string } | { skipUntil: number | null } | null {
  if (!r.capPct || !usage) return null;
  // A window whose reset has passed holds a stale number.
  const pct = (w: PlanUsage['week']) => (w && !(w.resetsAt !== null && w.resetsAt <= now) ? w.pct : 0);
  const week = pct(usage.week);
  if (week >= r.capPct) return { note: goalCapReached(r.capPct) };
  if (pct(usage.fiveHour) > FIVE_HOUR_LIMIT) return { skipUntil: usage.fiveHour!.resetsAt };
  return null;
}

export const ROUND_INSTRUCTION = 'Reply with the answer or result first, in plain sentences, with no narration of what you did. Then finish with one last line: ROUND: <done|progress|blocked|question|nothing> <one sentence>. The line is shown on the chat row and the loop card and its first sentence is the push text, so name what changed, in at most 100 characters; use nothing when there was nothing to do.';

export const goalMet = (text: string) => /\bGOAL MET\b/.test(text);

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

const MAX_TIMER = 2 ** 31 - 1;

// Node clamps setTimeout at 24.8 days and fires at once past it; longer waits go in chunks.
export function after(at: number, fn: () => void): NodeJS.Timeout {
  const left = at - Date.now();
  return setTimeout(() => (Date.now() >= at ? fn() : void after(at, fn)), Math.min(Math.max(0, left), MAX_TIMER));
}

export function fireTime(schedule: string, now = Date.now()) {
  const [m, h, dom, mon] = schedule.trim().split(/\s+/).slice(0, 4).map(Number);
  if ([m, h, dom, mon].some((n) => !Number.isInteger(n))) return null;
  const at = new Date(new Date(now).getFullYear(), mon - 1, dom, h, m);
  if (at.getTime() < now - 60_000) at.setFullYear(at.getFullYear() + 1);
  return at.getTime();
}

const describeLoop = (r: Repeat) =>
  once(r) ? `once at ${clock(r.nextAt!)}` : `${r.every ? `every ${span(r.every)}` : 'back to back'}${r.until ? ` until ${clock(r.until)}` : ''}`;

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
  patchRun(id: string, patch: Partial<Pick<ChatRun, 'state' | 'why' | 'round' | 'nextAt' | 'every' | 'endAt' | 'capPct' | 'usage' | 'builds'>>): void;
  push(title: string, body: string): void;
  usage(): PlanUsage | null;
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

  set(r: Repeat | null, note?: string, why = note ?? 'you stopped it') {
    clearTimeout(this.timer);
    this.due = false;
    const old = this.host.repeat();
    if (old?.runId && old.runId !== r?.runId) this.host.endRun(old.runId, r ? 'replaced by a new loop' : why);
    if (r && !r.runId) r = { ...r, runId: this.host.startRun(r) };
    this.host.setSession({ repeat: r });
    if (!r) return this.host.system(note ?? 'Loop off');
    this.host.system(r.goal ? goalPlan(r) : `Loop on, ${describeLoop(r)}`);
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
    this.host.system(`AgentView restarted, the ${r.goal ? 'goal' : 'loop'} ${r.paused ? 'stays paused' : `continues ${r.goal ? `: ${goalPlan(r)}` : describeLoop(r)}`}`);
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
    this.host.setSession({ repeat: { ...r, paused: false, ...(r.builds && { builds: [] }) } });
    this.patchRun({ state: 'running', why: '', ...(r.maxBuilds && { builds: 0 }) });
    this.host.system(`${r.goal ? 'Goal' : 'Loop'} resumed`);
    if (!r.nextAt || r.nextAt <= Date.now()) this.fire();
    else this.arm();
  }

  // A build the loop's chat started; the limit pauses the run at the next round.
  noteBuild(slug: string) {
    const r = this.host.repeat();
    if (!r?.maxBuilds || r.builds?.includes(slug)) return;
    const builds = [...(r.builds ?? []), slug];
    this.host.setSession({ repeat: { ...r, builds } });
    this.patchRun({ builds: builds.length });
  }

  runNow() {
    const r = this.host.repeat();
    if (!r || r.paused) return;
    if (this.host.running()) return this.host.system('The agent is busy, so there is no round to run now');
    this.roundAt = 0;
    this.fire();
  }

  stopRun() {
    const r = this.host.repeat();
    if (!r) return;
    this.stopped = { r, at: Date.now() };
    this.set(null, `${r.goal ? 'Goal' : 'Loop'} stopped`, 'you stopped it');
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
    if (r.endAt && Date.now() >= r.endAt) return { note: goalStoppedAt(r.endAt, r.round) };
    if (r.until && Date.now() >= r.until && !unrun(r)) return standing(r) ? { note: GOAL_RAN_OUT } : { note: `Loop finished at ${clock(r.until)} after ${r.round} ${r.round === 1 ? 'round' : 'rounds'}`, why: `finished at ${clock(r.until)}` };
    if (r.goal && !standing(r) && r.round >= MAX_GOAL_ROUNDS) return { note: goalNotMet(r.round) };
    return null;
  }

  fire() {
    const r = this.host.repeat();
    if (!r || this.held || r.paused) return;
    const end = this.finish(r);
    if (end) return this.set(null, end.note, end.why);
    if (r.maxBuilds && (r.builds?.length ?? 0) >= r.maxBuilds) return this.pauseAtLimit(r, r.maxBuilds);
    const usage = this.host.usage();
    const gate = usageGate(r, usage);
    if (gate && 'note' in gate) return this.set(null, gate.note);
    if (gate) return standing(r) ? this.skip(r, USAGE_SKIP) : this.defer(gate.skipUntil ?? Date.now() + GATE_RETRY_MS, skipText(USAGE_SKIP), true);
    // A standing goal skips a heartbeat that finds Claude busy or waiting for the user; the next one is a full interval away.
    if (standing(r) && (this.host.running() || this.host.asking())) return this.skip(r, this.host.asking() ? 'waiting for you' : 'still working');
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
    this.patchRun({ state: 'running', why: '', round, nextAt, usage });
    this.arm();
    this.host.sendPrompt(report ? reportPrompt(r.goal!) : r.prompt, r.goal ? 'goal' : 'loop', round, report);
  }

  private pauseAtLimit(r: Repeat, max: number) {
    clearTimeout(this.timer);
    this.due = false;
    this.host.setSession({ repeat: { ...r, paused: true } });
    this.patchRun({ state: 'paused', why: `build limit ${max} reached` });
    this.host.system(`Build limit reached: ${max} builds started. Resume to count ${max} more.`);
    this.host.push(`Loop paused: build limit ${max}`, 'Resume to count more');
  }

  private skip(r: Repeat, why: string) {
    const nextAt = Date.now() + r.every;
    this.host.setSession({ repeat: { ...r, nextAt } });
    this.patchRun({ nextAt });
    this.arm();
    this.host.system(skipText(why));
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
    this.host.system(`${why ? `${why}. ` : ''}${nextRound(nextAt)}, ${offCommand(r)} to end it`);
  }

  // Changes the active goal: every only on a standing goal, in range; anything invalid is ignored.
  edit(edit: RunEdit) {
    const r = this.host.repeat();
    if (!r?.goal) return;
    const next: Repeat = { ...r };
    const every = edit.every;
    if (typeof every === 'number' && standing(r) && every >= MIN_EVERY && every <= MAX_EVERY) Object.assign(next, { every, nextAt: Date.now() + every });
    if (edit.endAt === null) delete next.endAt;
    else if (typeof edit.endAt === 'number') next.endAt = edit.endAt;
    if (edit.capPct === null) delete next.capPct;
    else if (typeof edit.capPct === 'number' && edit.capPct >= 1 && edit.capPct <= 100) next.capPct = edit.capPct;
    this.host.setSession({ repeat: next });
    this.patchRun({ every: next.every || undefined, nextAt: next.nextAt, endAt: next.endAt, capPct: next.capPct });
    this.arm();
    this.host.system(goalPlan(next, true));
  }

  private patchRun(patch: Parameters<RepeatHost['patchRun']>[1]) {
    const id = this.host.repeat()?.runId;
    if (id) this.host.patchRun(id, patch);
  }

  private arm() {
    clearTimeout(this.timer);
    const r = this.host.repeat();
    const at = Math.min(r?.nextAt ?? Infinity, r && unrun(r) ? Infinity : (r?.until ?? Infinity), r?.endAt ?? Infinity);
    // The driver reports its exit after close(); a closed chat must not wake up again.
    if (!r || r.paused || at === Infinity || this.host.closed()) return;
    this.timer = after(at, () => this.fire());
  }
}

export const restorePrompt = (crons: Cron[], why: string) =>
  `${why}. It is now ${new Date().toString()}. Your scheduled jobs are below. First run CronList: a job that is still listed survived the restart but will not fire, so CronDelete it. Then CronCreate each job below once, with the same cron, prompt and recurring flag, so exactly one copy exists. If a one-shot job's time has already passed, run its prompt now instead. Reply in one line.\n\n${JSON.stringify(crons.map(({ schedule, prompt, recurring }) => ({ cron: schedule, prompt, recurring })), null, 2)}`;
