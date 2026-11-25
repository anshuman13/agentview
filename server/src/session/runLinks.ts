import { randomUUID } from 'node:crypto';
import type { ChatRun, RunOp } from '../../../shared/protocol.js';
import type { TurnResult } from '../agent/types.js';
import { ROUND_INSTRUCTION, STOPPED_BY_YOU, WAITING, openTries, roundResult } from './runs.js';
import type { AgentSession } from './session.js';

export class RunLinks {
  // The tries run whose comparison turn is running here.
  private compareRun: string | undefined;

  constructor(private s: AgentSession) {}

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
    const { runs } = this.s;
    const run = runs.jobFor(this.s.id);
    if (on && run?.state === 'running') runs.update(run.id, { state: 'paused', why: WAITING });
    else if (!on && run?.why === WAITING) runs.update(run.id, { state: 'running', why: '' });
  }

  endAll() {
    const { runs, id } = this.s;
    const job = runs.jobFor(id);
    if (job?.review !== 'pending') runs.end(job?.id, 'chat closed');
    for (const r of runs.list()) if ((r.kind === 'tries' || r.kind === 'build') && r.chatId === id && r.state !== 'done') runs.end(r.id, 'chat closed');
  }

  control(run: string, op: RunOp) {
    const { runs } = this.s;
    if (runs.get(run)?.kind === 'build') return this.s.build.control(op);
    if (op !== 'stop') return;
    if (runs.get(run)?.kind === 'tries') return runs.end(run, STOPPED_BY_YOU);
    if (runs.jobFor(this.s.id)?.id === run) {
      runs.end(run, STOPPED_BY_YOU);
      return void this.s.interrupt();
    }
  }

  record(r: TurnResult) {
    const { runs, state, turn } = this.s;
    const result = { ...roundResult(r.text, { failed: turn.lastError }), costUsd: turn.cost, sessionId: state.session.sessionId ?? undefined };
    if (state.session.sessionId) runs.reportTry(state.session.sessionId, result);
    const job = runs.jobOfSession(state.session.sessionId) ?? runs.jobFor(this.s.id);
    if (job) {
      runs.update(job.id, { chatId: this.s.id });
      runs.addRound(job.id, { n: job.rounds.length + 1, ...result });
      this.s.onJobTurn?.(job.id, turn.lastError);
    }
    const build = runs.buildFor(this.s.id);
    if (build) {
      if (!build.clearing) runs.addRound(build.id, { n: build.rounds.length + 1, ...result });
      void this.s.build.record(result.outcome, turn.lastError);
    }
    if (this.compareRun) {
      runs.addRound(this.compareRun, { n: 0, ...result });
      // The run stays open with its board until a try is kept or it is stopped.
      runs.update(this.compareRun, { state: 'paused', why: 'Pick a try to keep' });
      this.compareRun = undefined;
    }
  }
}
