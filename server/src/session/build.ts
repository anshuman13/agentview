import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { APPROVE, BLOCKED, BUILD_USAGE, FAILED, PAUSED_BY_YOU, WAITING_RESET, buildHelpers, buildSpecPrompt, burnRate, hhmm, moreBrief, nextStep, recapBrief, taskBrief, untilAt, type BuildArgs, type BuildStep, type BuildUsage } from '../../../shared/build.js';
import type { ChatRun, RoundOutcome } from '../../../shared/protocol.js';
import { specTasks } from '../../../shared/specTasks.js';
import { errText } from '../../../shared/util.js';
import { samplesSince } from '../usage/store.js';
import { after } from './wakeups.js';
import { ROUND_INSTRUCTION, STOPPED_BY_YOU, firstSentence } from './runs.js';
import type { AgentSession } from './session.js';

// A spec run in one chat: each task in a fresh context (/clear, then a brief), until the list is done, the stop time, or the usage cap.
export class BuildLoop {
  private waitTimer: NodeJS.Timeout | null = null;

  constructor(private s: AgentSession) {}

  private get run() {
    return this.s.runs.buildFor(this.s.id);
  }

  private abs(spec: string) {
    return path.resolve(this.s.cwd, spec);
  }

  start(text: string, args: BuildArgs | 'usage', id: string = randomUUID()) {
    const s = this.s;
    s.pushEvent({ id, kind: 'user', text, at: Date.now() });
    if (args === 'usage') return s.system(BUILD_USAGE);
    const existing = this.run;
    if (args.until && !args.spec && !args.request) {
      if (!existing) return s.system(BUILD_USAGE);
      const until = untilAt(args.until);
      s.runs.update(existing.id, { until });
      return s.system(`Build keeps going until ${hhmm(until)}`);
    }
    if (s.state.session.running) return s.system('Wait for this turn to end, then start the build');
    // Build all on the spec a run is waiting on approves it.
    if (existing && args.spec && existing.spec === args.spec && existing.why === APPROVE) return this.resume();
    if (existing) return s.system('This chat already has a build run; stop it first');
    const until = args.until ? untilAt(args.until) : null;
    const what = args.spec ?? args.request;
    s.runs.start({
      kind: 'build',
      sessionId: s.state.session.sessionId ?? '',
      chatId: s.id,
      cwd: s.cwd,
      title: `Build: ${firstSentence(args.spec ? path.basename(args.spec, '.md') : args.request, 70)}`,
      what,
      provider: s.state.session.provider,
      spec: args.spec ?? undefined,
      until,
      auto: args.auto,
      phase: args.spec ? 'task' : 'spec',
    });
    s.system(`Build started${args.auto ? ', no approval' : ''}${until ? `, keeps going until ${hhmm(until)}` : ''}`);
    if (args.spec) void this.advance(null);
    else this.send(buildSpecPrompt(args.request));
  }

  // A turn of the chat ended while its build run is open.
  async record(outcome: RoundOutcome, failed: boolean) {
    const run = this.run;
    if (!run) return;
    const { runs } = this.s;
    runs.update(run.id, { sessionId: this.s.state.session.sessionId ?? run.sessionId });
    if (run.clearing) {
      runs.update(run.id, { clearing: false });
      return this.sendStep(run);
    }
    if (run.phase === 'recap') return runs.end(run.id, run.why || 'done');
    // At the 5-hour limit the run pauses on its own account and resumes a minute after the reset.
    const reset = this.s.usage.reset;
    if (reset && run.state === 'running') {
      runs.update(run.id, { state: 'paused', why: `${WAITING_RESET} at ${hhmm(reset)}`, nextAt: reset + 60_000, pausing: false });
      return this.armWait();
    }
    if (run.phase === 'spec') return this.specWritten(run);
    // A message from you answers a blocked task or a failed turn, and the run goes on.
    if (run.state === 'paused' && (run.why === BLOCKED || run.why === FAILED)) runs.update(run.id, { state: 'running', why: '' });
    if (run.state !== 'running') return;
    if (run.phase === 'more') runs.update(run.id, { idle: (await this.open(run)) > 0 ? 0 : (run.idle ?? 0) + 1 });
    return this.advance({ asked: outcome === 'blocked' || outcome === 'question', failed });
  }

  // Resume and Build all; Pause waits for the task to finish.
  control(op: 'pause' | 'resume' | 'stop') {
    const run = this.run;
    if (!run) return;
    const { runs } = this.s;
    if (op === 'stop') {
      runs.end(run.id, STOPPED_BY_YOU);
      if (this.s.state.session.running) void this.s.interrupt();
    } else if (op === 'pause') {
      if (this.s.state.session.running) runs.update(run.id, { pausing: true, why: 'Pausing after this task' });
      else runs.update(run.id, { state: 'paused', why: PAUSED_BY_YOU });
    } else this.resume();
  }

  // After a restart: a run that was between steps sends its next one.
  kick() {
    const run = this.run;
    if (run?.state === 'running' && !this.s.state.session.running) void (run.clearing ? this.sendStep(run) : this.advance(null));
    this.armWait();
  }

  private armWait() {
    const run = this.run;
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    if (!run?.nextAt || run.state !== 'paused' || !run.why.startsWith(WAITING_RESET)) return;
    this.waitTimer = after(run.nextAt, () => {
      this.waitTimer = null;
      const now = this.run;
      if (now?.state === 'paused' && now.why.startsWith(WAITING_RESET)) this.resume();
    });
  }

  private resume() {
    const run = this.run;
    if (!run) return;
    this.s.runs.update(run.id, { state: 'running', why: '', pausing: false, nextAt: null, ...(run.phase === 'spec' && { phase: 'task' }) });
    if (!this.s.state.session.running) void this.advance(null);
  }

  private async specWritten(run: ChatRun) {
    const spec = await this.newestSpec(run.startedAt);
    if (!spec) return this.s.runs.end(run.id, 'no spec was written');
    this.s.runs.update(run.id, { spec });
    if (!run.auto) return this.s.runs.update(run.id, { state: 'paused', why: APPROVE });
    this.s.runs.update(run.id, { phase: 'task' });
    return this.advance(null);
  }

  private async advance(turn: { asked: boolean; failed: boolean } | null) {
    const run = this.run;
    if (!run?.spec) return;
    const open = await this.open(run);
    const step = nextStep({ pausing: Boolean(run.pausing), asked: turn?.asked ?? false, failed: turn?.failed ?? false, auto: Boolean(run.auto), open, until: run.until ?? null, idle: run.idle ?? 0, weekPct: this.s.state.session.usage?.week?.pct ?? null, now: Date.now() });
    this.go(run, step);
  }

  private go(run: ChatRun, step: BuildStep) {
    const { runs } = this.s;
    if (step.kind === 'pause') return runs.update(run.id, { state: 'paused', why: step.why, pausing: false });
    if (step.kind === 'recap') {
      runs.update(run.id, { phase: 'recap', why: step.why });
      return this.send(recapBrief(run.spec!, step.why));
    }
    // Each task and each search for more starts from a fresh context.
    runs.update(run.id, { phase: step.kind, clearing: true });
    this.s.enqueue('/clear');
  }

  private async sendStep(run: ChatRun) {
    if (!run.spec) return;
    if (run.phase === 'more') return this.send(moreBrief(run.spec, run.until ?? Date.now()));
    const tasks = specTasks(await readFile(this.abs(run.spec), 'utf8').catch(() => ''));
    const n = tasks.filter((t) => t.done).length + 1;
    const usage = this.usage(run);
    this.s.runs.update(run.id, { helpers: buildHelpers(usage) });
    this.send(taskBrief(run.spec, n, tasks.length, Boolean(run.auto), usage));
  }

  // The plan's 5-hour numbers, with the burn of the last 15 minutes split over the build chat and the helpers it allowed.
  private usage(run: ChatRun): BuildUsage | null {
    const { usage, account, capabilities } = this.s.state.session;
    if (!usage?.fiveHour) return null;
    if (!capabilities?.subagents) return { pct: usage.fiveHour.pct, resetsAt: usage.fiveHour.resetsAt, perAgent: null, weekPct: usage.week?.pct ?? null, solo: true };
    const now = Date.now();
    // A usage database error must not stall the run.
    let rate: number | null = null;
    try {
      rate = burnRate(samplesSince(account, now - 15 * 60_000));
    } catch (err) {
      console.error('build usage:', errText(err));
    }
    const perAgent = rate === null ? null : rate / (1 + (run.helpers ?? 0));
    return { pct: usage.fiveHour.pct, resetsAt: usage.fiveHour.resetsAt, perAgent, weekPct: usage.week?.pct ?? null };
  }

  private send(text: string) {
    const id = randomUUID();
    // After the turn has ended, so the brief is a new turn.
    setImmediate(() => {
      this.s.pushEvent({ id, kind: 'user', text, at: Date.now() });
      this.s.enqueue(`${text}\n\n${ROUND_INSTRUCTION}`, id);
    });
  }

  private async open(run: ChatRun) {
    const text = run.spec ? await readFile(this.abs(run.spec), 'utf8').catch(() => '') : '';
    const tasks = specTasks(text);
    const done = tasks.filter((t) => t.done).length;
    this.s.runs.update(run.id, { progress: `${done} of ${tasks.length}`, task: tasks.find((t) => !t.done)?.text ?? '' });
    return tasks.length - done;
  }

  // The spec the spec turn wrote: the newest file in .claude/specs changed since the run started.
  private async newestSpec(since: number) {
    const dir = path.join(this.s.cwd, '.claude', 'specs');
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md') && !n.endsWith('.notes.md'));
    const files = await Promise.all(names.map(async (n) => ({ n, t: (await stat(path.join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })));
    const best = files.filter((f) => f.t >= since - 1000).sort((a, b) => b.t - a.t)[0];
    return best ? `.claude/specs/${best.n}` : null;
  }
}
