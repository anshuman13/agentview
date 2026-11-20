import { randomUUID } from 'node:crypto';
import { MAX_GOAL_ROUNDS, type ChatRun, type Repeat, type RunEdit, type RunOp } from '../../../shared/protocol.js';
import type { TurnResult } from '../agent/types.js';
import { APP, post } from '../integrations/notify.js';
import { ROUND_INSTRUCTION, once } from './repeat.js';
import { WAITING, openTries, roundResult } from './runs.js';
import type { AgentSession } from './session.js';
import { STOPPED_BY_YOU } from '../../../shared/goalText.js';

export class RunLinks {
  // The tries run whose comparison turn is running here.
  private compareRun: string | undefined;

  constructor(private s: AgentSession) {}

  repeatHost() {
    const s = this.s;
    return {
      repeat: () => s.state.session.repeat,
      running: () => s.state.session.running,
      closed: () => s.closed,
      setSession: (patch: Parameters<AgentSession['setSession']>[0]) => s.setSession(patch),
      system: (text: string) => s.system(text),
      startRun: (r: Repeat) => this.start(r),
      resumeRun: (r: Repeat) => this.resume(r),
      endRun: (id: string, why: string) => s.runs.end(id, why),
      reopenRun: (id: string) => s.runs.reopen(id),
      patchRun: (id: string, patch: Parameters<AgentSession['runs']['update']>[1]) => s.runs.update(id, patch),
      push: (title: string, body: string) => post(title, s.runs.get(s.state.session.repeat?.runId)?.title ?? '', body, `${APP}/?chat=${s.id}`),
      usage: () => s.state.session.usage ?? null,
      runCost: () => s.runs.get(s.state.session.repeat?.runId)?.costUsd ?? 0,
      asking: () => s.state.pending.length > 0,
      sendPrompt: (text: string, auto: 'loop' | 'goal', round: number, report?: boolean) => {
        const id = randomUUID();
        s.turn.reportTurn = report ? id : undefined;
        s.sendPrompt(text, id, { auto, round });
      },
    };
  }

  title(what: string) {
    return (this.s.title || what.split('\n')[0]).slice(0, 80);
  }

  private start(r: Repeat) {
    const what = r.goal ?? r.prompt;
    return this.s.runs.start({ kind: r.goal ? 'goal' : 'loop', sessionId: this.s.state.session.sessionId ?? '', chatId: this.s.id, cwd: this.s.cwd, title: this.title(what), what, provider: this.s.state.session.provider, round: r.round, max: r.goal && !r.every ? MAX_GOAL_ROUNDS : 0, nextAt: r.nextAt, ...(once(r) && { once: true }), ...(r.goal && r.every && { every: r.every }), ...(r.endAt && { endAt: r.endAt }), ...(r.capPct && { capPct: r.capPct }), ...(r.capUsd && { capUsd: r.capUsd }), ...(r.maxBuilds && { maxBuilds: r.maxBuilds, builds: r.builds?.length ?? 0 }) });
  }

  // A restart keeps the run of a loop or goal; the chat has a new id.
  private resume(r: Repeat) {
    const run = this.s.runs.get(r.runId);
    if (!run || run.state === 'done') return this.start(r);
    this.s.runs.update(run.id, { chatId: this.s.id });
    return run.id;
  }

  // Every try has reported: one turn here compares them and recommends one, and the run ends with it.
  compareTries(run: ChatRun) {
    const id = randomUUID();
    const text = 'Compare the tries of this run (each worktree is on its tries/ branch; read its diff if you need to) and recommend one, with a two-line reason.';
    this.s.system(`All ${openTries(run).length} tries reported`);
    this.compareRun = run.id;
    this.s.pushEvent({ id, kind: 'user', text, at: Date.now() });
    this.s.enqueue(`${text}\n\n${ROUND_INSTRUCTION}`, id);
  }

  waitingOnUser(on: boolean) {
    const { runs, state } = this.s;
    for (const id of [state.session.repeat?.runId, runs.jobFor(this.s.id)?.id]) {
      const run = runs.get(id);
      if (on && run?.state === 'running') runs.update(id, { state: 'paused', why: WAITING });
      else if (!on && run?.why === WAITING) runs.update(id, { state: 'running', why: '' });
    }
  }

  endAll() {
    const { runs, state, id } = this.s;
    runs.end(state.session.repeat?.runId, 'chat closed');
    const job = runs.jobFor(id);
    if (job?.review !== 'pending') runs.end(job?.id, 'chat closed');
    for (const r of runs.list()) if (r.kind === 'tries' && r.chatId === id) runs.end(r.id, 'chat closed');
  }

  control(run: string, op: RunOp) {
    const { runs, repeater, state } = this.s;
    if (runs.get(run)?.kind === 'tries') return op === 'stop' ? runs.end(run, STOPPED_BY_YOU) : undefined;
    if (runs.jobFor(this.s.id)?.id === run) {
      if (op !== 'stop') return;
      runs.end(run, STOPPED_BY_YOU);
      return void this.s.interrupt();
    }
    if (op === 'restore') return repeater.restore(run);
    if (state.session.repeat?.runId !== run) return;
    if (op === 'pause') repeater.pause();
    else if (op === 'resume') repeater.unpause();
    else if (op === 'now') repeater.runNow();
    else if (op === 'stop') repeater.stopRun();
  }

  edit(run: string, edit: RunEdit) {
    if (this.s.state.session.repeat?.runId === run) this.s.repeater.edit(edit);
  }

  record(r: TurnResult, report: string | undefined) {
    const { runs, state, roundNote, turn } = this.s;
    const repeat = state.session.repeat;
    const result = { ...roundResult(r.text, { failed: turn.lastError }), costUsd: turn.cost };
    if (state.session.sessionId) runs.reportTry(state.session.sessionId, result);
    const job = runs.jobOfSession(state.session.sessionId) ?? runs.jobFor(this.s.id);
    if (job) {
      runs.update(job.id, { chatId: this.s.id });
      runs.addRound(job.id, { n: job.rounds.length + 1, ...result });
      this.s.onJobTurn?.(job.id, turn.lastError);
    }
    if (this.compareRun) {
      runs.addRound(this.compareRun, { n: 0, ...result });
      // The run stays open with its board until a try is kept or it is stopped.
      runs.update(this.compareRun, { state: 'paused', why: 'Pick a try to keep' });
      this.compareRun = undefined;
    }
    if (repeat?.runId && roundNote) runs.addRound(repeat.runId, { n: repeat.round, outcome: roundNote.outcome, line: roundNote.line, costUsd: turn.cost, ...(report && { report }) });
  }
}
