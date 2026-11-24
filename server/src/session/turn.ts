import { randomUUID } from 'node:crypto';
import { costRise } from '../../../shared/cost.js';
import { providerLabel } from '../../../shared/providers.js';
import { roundOf } from '../../../shared/edits.js';
import { clock } from '../../../shared/util.js';
import { goalMet as goalMetText, skipText } from '../../../shared/goalText.js';
import type { Repeat } from '../../../shared/protocol.js';
import type { TurnResult } from '../agent/types.js';
import { goalMet } from './repeat.js';
import { roundResult } from './runs.js';
import type { AgentSession } from './session.js';

const COMPACT = Symbol('compact');

const planChangeText = (next: string[]) =>
  next.length
    ? `I changed your plan. The remaining steps are now:\n${next.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nFollow this plan from here and update set_status to match.`
    : 'I removed the remaining steps of your plan. Finish the current step, then stop and tell me where things stand.';

export class Turn {
  count = 0;
  lastResult = '';
  lastError = false;
  cost = 0;
  // The last turn was a loop round or goal round; its reply ends with a ROUND line.
  roundTurn = false;
  // The id of the prompt of the weekly report round of a standing goal, while that round runs.
  reportTurn: string | undefined;
  private lastCost = 0;
  // A message sent mid-turn missed the turn's last step, so the CLI starts a turn for it.
  private expectTurn = false;

  constructor(private s: AgentSession) {}

  start() {
    this.count++;
  }

  finish() {
    this.count = Math.max(0, this.count - 1);
  }

  // True when no turn is left after the input the driver dropped.
  drop(inputs: number) {
    this.count = Math.max(0, this.count - inputs);
    return this.count === 0;
  }

  changePlan(next: string[]) {
    this.s.pushEvent({ id: randomUUID(), kind: 'plan', next, at: Date.now() });
    const text = planChangeText(next);
    // Mid-turn it reaches the agent at its next step or before the turn would end; an agent that cannot take it gets a prompt.
    if (this.s.state.session.running) void this.s.driver.inject(text).then((taken) => taken || this.s.sendPrompt(text));
    else this.s.sendPrompt(text);
  }

  started(why?: string) {
    const s = this.s;
    s.wakeups.woke();
    this.start();
    s.setSession({ running: true });
    if (this.expectTurn && !why) {
      this.expectTurn = false;
      return;
    }
    const label = providerLabel(s.driver.provider);
    s.setStatus(why ?? 'Woke up for a scheduled or background task');
    const cron = !why && s.crons.length === 1 ? s.crons[0] : null;
    s.system(why ?? (cron ? `${label} woke up: ${cron.prompt.slice(0, 100)}` : `${label} woke up on its own`));
  }

  result(r: TurnResult) {
    const s = this.s;
    // Before a switch to the other account the messages stay held, since the CLI that has them is replaced.
    if (s.waiting.pending.length && !s.usage.reset) this.releaseHeld();
    this.lastResult = r.ok ? r.text : '';
    this.lastError = !r.ok || Boolean(r.isError);
    s.failed = this.lastError;
    const repeat = s.state.session.repeat;
    const met = Boolean(repeat?.goal && goalMet(this.lastResult));
    this.noteCost(r.costUsd);
    const report = this.reportTurn;
    s.roundNote = this.roundNote(r.text, repeat, met, report);
    this.roundTurn = false;
    this.reportTurn = undefined;
    s.pushEvent({ id: r.id, kind: 'result', text: r.text, costUsd: r.costUsd, isError: r.isError, at: Date.now(), model: s.state.session.model });
    s.links.record(r, report);
    if (repeat?.goal && met) {
      const text = goalMetText(repeat.round);
      s.repeater.set(null, text);
    }
    this.ended();
  }

  private noteCost(costUsd: number) {
    this.cost = costUsd > 0 ? costRise(costUsd, this.lastCost) : 0;
    if (costUsd > 0) this.lastCost = costUsd;
  }

  private roundNote(text: string, repeat: Repeat | null, met: boolean, report: string | undefined) {
    if (!repeat?.runId) return null;
    // A turn the run did not start, such as a background agent finishing, still reports with a ROUND line.
    const goal = Boolean(repeat.goal);
    if (!this.roundTurn) return roundOf(text) ? { ...roundResult(text, { failed: this.lastError, met }), goal, ends: met } : null;
    const note = { ...roundResult(text, { failed: this.lastError, met }), goal, ends: met || this.s.repeater.ends() };
    if (report && !this.lastError && !met) note.outcome = 'progress';
    return note;
  }

  private releaseHeld() {
    this.expectTurn = true;
    this.s.waiting.release();
  }

  ended() {
    const s = this.s;
    s.review.finish();
    this.finish();
    const stopped = this.count === 0 && s.state.session.stopping;
    const idle = this.count === 0 && !s.state.session.stopping;
    if (idle && s.usage.failOver()) {
      s.waiting.requeuePending();
      s.usage.clear();
      s.setSession({ compacting: false });
      return;
    }
    if (s.waiting.pending.length && s.usage.reset) this.releaseHeld();
    const next = idle ? this.followUp() : null;
    s.setSession({ running: this.count > 0 || next !== null, compacting: false, stopping: false });
    if (next === COMPACT) s.compact();
    else if (next) s.sendPrompt(next);
    else if (stopped) {
      // Messages typed while the stop was in flight go on in a fresh turn.
      s.waiting.dequeue();
      s.repeater.defer();
    } else if (idle) this.repeatWhenIdle();
    // A turn that ends without a result (a local command) must not read the last one's.
    s.usage.clear();
    this.lastResult = '';
    this.lastError = false;
    this.cost = 0;
    if (idle && !s.state.session.running && !s.state.pending.length) s.onIdle?.();
  }

  private repeatWhenIdle() {
    const { usage, repeater, state } = this.s;
    if (usage.reset && state.session.repeat) repeater.defer(usage.reset, skipText('usage limit reached'), true);
    else if (usage.reset) this.s.system(`Usage limit reached, resets at ${clock(usage.reset)}`, false, usage.reset);
    else if (this.lastError) repeater.defer();
    else if (repeater.due || state.session.repeat?.every === 0) repeater.fire();
  }

  private followUp() {
    // A plan change that came after the agent's last step goes as the next prompt.
    const plan = this.s.driver.clearInjected();
    if (plan) return plan;
    // After a failed turn or a usage limit the hooks wait for the next good turn, which still sees the edits.
    const failed = Boolean(this.lastError || this.s.usage.reset);
    if (!failed && this.s.compaction.due(this.s.state.session.context ?? 0, this.s.state.session.contextWindow)) return COMPACT;
    return this.s.waiting.dequeue() || failed ? null : this.s.hooks.afterTurn();
  }

  // The agent process is gone; its queued input went with it, but the events stay.
  exited() {
    const s = this.s;
    s.review.finish();
    s.waiting.requeuePending();
    this.expectTurn = false;
    this.count = 0;
    s.setSession({ running: false, stopping: false, compacting: false });
    s.driver.clearInjected();
    s.approvals.denyAll(`${providerLabel(s.driver.provider)} exited before this was answered.`);
    const repeat = s.state.session.repeat;
    if (this.roundTurn && repeat?.runId) s.runs.addRound(repeat.runId, { n: s.runs.nextRoundN(repeat.runId), outcome: 'failed', line: `${providerLabel(s.driver.provider)} exited`, costUsd: 0 });
    this.roundTurn = false;
    // Closing the chat also ends the CLI; a job run stays open so its review or a reopened chat can take it back.
    const job = s.closed ? undefined : s.runs.jobFor(s.id);
    if (job && job.review !== 'pending') {
      s.runs.addRound(job.id, { n: 1, outcome: 'failed', line: `${providerLabel(s.driver.provider)} exited`, costUsd: 0 });
      s.runs.end(job.id, 'exited');
    }
    // Queued messages are not lost with the process; the first one starts a fresh CLI.
    if (!s.waiting.dequeue()) s.repeater.defer();
    s.log.orphanRunning();
  }
}
