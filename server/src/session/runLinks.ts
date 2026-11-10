import { randomUUID } from 'node:crypto';
import { MAX_GOAL_ROUNDS, type ChatRun, type Repeat, type RunEdit, type RunOp } from '../../../shared/protocol.js';
import type { TurnResult } from '../agent/types.js';
import { ROUND_INSTRUCTION } from './repeat.js';
import { WAITING, openTries, roundResult } from './runs.js';
import type { AgentSession } from './session.js';

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
      usage: () => s.state.session.usage ?? null,
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
    return this.s.runs.start({ kind: r.goal ? 'goal' : 'loop', sessionId: this.s.state.session.sessionId ?? '', chatId: this.s.id, title: this.title(what), what, provider: this.s.state.session.provider, round: r.round, max: r.goal && !r.every ? MAX_GOAL_ROUNDS : 0, nextAt: r.nextAt, ...(r.goal && r.every && { every: r.every }), ...(r.endAt && { endAt: r.endAt }), ...(r.capPct && { capPct: r.capPct }) });
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
    const { runs, state, cycle } = this.s;
    for (const id of [state.session.repeat?.runId, cycle.run, runs.jobFor(this.s.id)?.id]) {
      const run = runs.get(id);
      if (on && run?.state === 'running') runs.update(id, { state: 'paused', why: WAITING });
      else if (!on && run?.why === WAITING) runs.update(id, { state: 'running', why: '' });
    }
  }

  endAll() {
    const { runs, state, cycle, id } = this.s;
    runs.end(state.session.repeat?.runId, 'chat closed');
    runs.end(cycle.run, 'chat closed');
    runs.end(runs.jobFor(id)?.id, 'chat closed');
    for (const r of runs.list()) if (r.kind === 'tries' && r.chatId === id) runs.end(r.id, 'chat closed');
  }

  control(run: string, op: RunOp) {
    const { runs, cycle, repeater, state } = this.s;
    if (runs.get(run)?.kind === 'tries') return op === 'stop' ? runs.end(run, 'you stopped it') : undefined;
    if (cycle.run === run) return op === 'stop' ? cycle.set(false) : undefined;
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
    const job = runs.jobFor(this.s.id);
    if (job) {
      runs.addRound(job.id, { n: 1, ...result });
      runs.end(job.id, 'turn finished');
    }
    if (this.compareRun) {
      runs.addRound(this.compareRun, { n: 0, ...result });
      runs.end(this.compareRun, 'all tries reported');
      this.compareRun = undefined;
    }
    if (repeat?.runId && roundNote) runs.addRound(repeat.runId, { n: repeat.round, outcome: roundNote.outcome, line: roundNote.line, costUsd: turn.cost, ...(report && { report }) });
  }
}
