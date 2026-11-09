import { randomUUID } from 'node:crypto';
import { costRise } from '../../../shared/cost.js';
import { providerLabel } from '../../../shared/providers.js';
import { clock } from '../../../shared/util.js';
import type { Repeat } from '../../../shared/protocol.js';
import type { TurnResult } from '../agent/types.js';
import { advance, looping, planChangeText } from './loop.js';
import { goalMet } from './repeat.js';
import { roundResult } from './runs.js';
import type { AgentSession } from './session.js';

const COMPACT = Symbol('compact');

export class Turn {
  count = 0;
  lastResult = '';
  lastError = false;
  cost = 0;
  // The last turn was a loop round or goal check; its reply ends with a ROUND line.
  roundTurn = false;
  // The id of the prompt of the weekly report round of a standing goal, while that round runs.
  reportTurn: string | undefined;
  private lastCost = 0;
  private planChange: string | null = null;
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
    if (this.s.state.session.running) this.planChange = text;
    else this.s.sendPrompt(text);
  }

  takePlanChange() {
    const text = this.planChange;
    this.planChange = null;
    return text;
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
    if (repeat?.goal && met) s.repeater.set(null, `Goal met after ${repeat.round} ${repeat.round === 1 ? 'check' : 'checks'}: ${repeat.goal}`, 'goal met');
    this.ended();
  }

  private noteCost(costUsd: number) {
    this.cost = costUsd > 0 ? costRise(costUsd, this.lastCost) : 0;
    if (costUsd > 0) this.lastCost = costUsd;
  }

  private roundNote(text: string, repeat: Repeat | null, met: boolean, report: string | undefined) {
    if (!this.roundTurn || !repeat?.runId) return null;
    const note = { ...roundResult(text, { failed: this.lastError, met }), ends: met || this.s.repeater.ends() };
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
    if (idle && !this.lastError && s.cycle.askReplyApproval(this.lastResult)) return;
    const before = s.state.session.loop;
    const loop = idle ? advance(before, this.lastResult, { planDenied: s.cycle.planDenied, failed: this.lastError }) : null;
    if (loop) {
      s.setSession({ loop: loop.state });
      if (looping(before)) s.cycle.round(before, loop.state);
    }
    const next = idle && !loop?.step ? this.followUp() : null;
    s.setSession({ running: this.count > 0 || next !== null || Boolean(loop?.step), compacting: false, stopping: false });
    if (loop && !loop.step && loop.note) s.cycle.end(loop.note);
    if (loop?.step) void s.cycle.runStep(loop.step);
    else if (next === COMPACT) s.compact();
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
    if (usage.reset && state.session.repeat) repeater.defer(usage.reset, 'Usage limit reached, loop round', true);
    else if (usage.reset) this.s.system(`Usage limit reached, resets at ${clock(usage.reset)}`);
    else if (this.lastError) repeater.defer();
    else if (repeater.due || state.session.repeat?.every === 0) repeater.fire();
  }

  private followUp() {
    const plan = this.takePlanChange();
    if (plan) return plan;
    if (this.s.compaction.due(this.s.state.session.context ?? 0, this.s.state.session.contextWindow)) return COMPACT;
    return this.s.waiting.dequeue() ? null : this.s.hooks.afterTurn();
  }

  // The agent process is gone; its queued input went with it, but the events stay.
  exited() {
    const s = this.s;
    s.review.finish();
    s.waiting.requeuePending();
    this.expectTurn = false;
    this.count = 0;
    s.setSession({ running: false, stopping: false, compacting: false });
    this.planChange = null;
    s.driver.clearInjected();
    s.approvals.denyAll(`${providerLabel(s.driver.provider)} exited before this was answered.`);
    const repeat = s.state.session.repeat;
    if (this.roundTurn && repeat?.runId) s.runs.addRound(repeat.runId, { n: repeat.round, outcome: 'failed', line: `${providerLabel(s.driver.provider)} exited`, costUsd: 0 });
    this.roundTurn = false;
    s.cycle.exited();
    // Queued messages are not lost with the process; the first one starts a fresh CLI.
    if (!s.waiting.dequeue()) s.repeater.defer();
    s.log.orphanRunning();
  }
}
