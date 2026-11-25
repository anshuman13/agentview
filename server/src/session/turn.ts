import { randomUUID } from 'node:crypto';
import { costRise } from '../../../shared/cost.js';
import { providerLabel } from '../../../shared/providers.js';
import { clock } from '../../../shared/util.js';
import type { TurnResult } from '../agent/types.js';
import type { UserEvent } from './messageQueue.js';
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
  private lastCost = 0;
  // A message sent mid-turn missed the turn's last step, so the CLI starts a turn for it.
  private expectTurn = false;
  // The waiting message Send now stopped the turn for, until that turn's result arrives.
  sendingNow: string | undefined;

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
    // Send now stopped this turn on purpose: an error is the stop itself, and the message it cancelled is sent again.
    const sentNow = this.sendingNow;
    this.sendingNow = undefined;
    const stopped = Boolean(sentNow) && !r.ok;
    if (stopped) r = { ...r, isError: false, ok: true, text: '' };
    const cancelled = stopped ? s.waiting.pending.find((e) => e.id === sentNow) : undefined;
    if (cancelled) s.waiting.pending = s.waiting.pending.filter((e) => e !== cancelled);
    // Before a switch to the other account the messages stay held, since the CLI that has them is replaced.
    if (s.waiting.pending.length && !s.usage.reset) this.releaseHeld();
    this.lastResult = r.ok ? r.text : '';
    this.lastError = !r.ok || Boolean(r.isError);
    s.failed = this.lastError;
    this.noteCost(r.costUsd);
    s.pushEvent({ id: r.id, kind: 'result', text: r.text, costUsd: r.costUsd, isError: r.isError, at: Date.now(), model: s.state.session.model });
    s.links.record(r);
    if (cancelled) this.resend(cancelled);
    this.ended();
  }

  private noteCost(costUsd: number) {
    this.cost = costUsd > 0 ? costRise(costUsd, this.lastCost) : 0;
    if (costUsd > 0) this.lastCost = costUsd;
  }

  // The stop ended the turn with the waiting message in it unanswered, so it goes again as the next prompt, below the stopped turn.
  private resend(ev: UserEvent) {
    const s = this.s;
    ev.queued = false;
    ev.at = Date.now();
    s.log.moveToEnd([ev]);
    s.enqueue(ev.text, ev.id);
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
    } else if (idle && s.usage.reset) s.system(`Usage limit reached, resets at ${clock(s.usage.reset)}`, false, s.usage.reset);
    // A turn that ends without a result (a local command) must not read the last one's.
    s.usage.clear();
    this.lastResult = '';
    this.lastError = false;
    this.cost = 0;
    if (idle && !s.state.session.running && !s.state.pending.length) s.onIdle?.();
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
    // Closing the chat also ends the CLI; a job run stays open so its review or a reopened chat can take it back.
    const job = s.closed ? undefined : s.runs.jobFor(s.id);
    if (job && job.review !== 'pending') {
      s.runs.addRound(job.id, { n: 1, outcome: 'failed', line: `${providerLabel(s.driver.provider)} exited`, costUsd: 0, sessionId: s.state.session.sessionId ?? undefined });
      s.runs.end(job.id, 'exited');
    }
    // Queued messages are not lost with the process; the first one starts a fresh CLI.
    s.waiting.dequeue();
    s.log.orphanRunning();
  }
}
