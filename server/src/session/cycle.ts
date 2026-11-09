import { randomUUID } from 'node:crypto';
import type { Effort, LoopState } from '../../../shared/protocol.js';
import { providerLabel } from '../../../shared/providers.js';
import { errText } from '../../../shared/util.js';
import type { AskOptions, Decision } from '../agent/types.js';
import { looping, loopOff, needsApproval, phaseRound, planStep, withLoop, type LoopStep } from './loop.js';
import type { AgentSession } from './session.js';

export class BuildCycle {
  run: string | undefined;
  planDenied = false;
  // ExitPlanMode came, or its approval was asked from the reply, so the plan step has no approval left to ask.
  private planAnswered = false;
  private prevModel: string | null = null;
  private prevEffort: Effort | null = null;
  private replyApproval: AbortController | null = null;

  constructor(private s: AgentSession) {}

  set(on: boolean, max?: number) {
    if (!on) this.s.runs.end(this.run, 'you stopped it');
    const next = withLoop(this.s.state.session.loop, on, max);
    this.s.setSession({ loop: next });
    this.s.system(on ? `Build cycle on: plan, build and test, up to ${next.max} ${next.max === 1 ? 'round' : 'rounds'}` : 'Build cycle off');
  }

  restore(loop: LoopState) {
    if (!looping(loop)) return this.s.setSession({ loop });
    this.s.setSession({ loop: loopOff(loop.max) });
    this.s.system('Build cycle interrupted by a restart. Send a message to start it again.');
  }

  async start(task: string, id: string) {
    const { state, links } = this.s;
    this.s.pushEvent({ id, kind: 'user', text: task, at: Date.now() });
    this.prevModel = state.session.model;
    this.prevEffort = state.session.effort;
    this.planDenied = false;
    this.planAnswered = false;
    this.s.setSession({ loop: { ...state.session.loop, round: 1, phase: 'plan' } });
    this.run = this.s.runs.start({ kind: 'cycle', sessionId: state.session.sessionId ?? '', chatId: this.s.id, title: links.title(task), what: task, provider: state.session.provider, round: 1, max: state.session.loop.max });
    await this.runStep(planStep(task), false);
  }

  async runStep(step: LoopStep, marker = true) {
    const { state, turn, settings, driver } = this.s;
    const role = driver.roleModel(step.phase);
    turn.start();
    this.s.setSession({ running: true });
    try {
      if (role && state.session.model !== role.model) await settings.setModel(role.model);
      if (role?.effort && state.session.effort !== role.effort) await settings.setEffort(role.effort);
      if (state.session.permissionMode !== step.mode) await settings.setPermissionMode(step.mode);
    } catch (err) {
      // Nothing was sent, so no turn will end and clear running; stop the loop here.
      this.s.setSession({ running: turn.count > 1, loop: { ...state.session.loop, phase: 'failed' } });
      this.end(`Build cycle stopped: could not switch to the ${step.phase} step (${errText(err)})`);
      if (turn.count === 1) this.s.waiting.dequeue();
      return;
    } finally {
      // An exit during the switch already reset the count.
      turn.finish();
    }
    // Stop pressed while the model or mode was switching: send nothing.
    if (!looping(state.session.loop)) {
      if (turn.count === 0) this.s.setSession({ running: false, stopping: false });
      return;
    }
    if (marker) this.s.pushEvent({ id: randomUUID(), kind: 'user', text: step.label, at: Date.now(), phase: step.phase });
    this.s.enqueue(step.prompt);
  }

  planDone(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<Decision> | null {
    const plan = toolName === 'ExitPlanMode' && this.s.state.session.loop.phase === 'plan';
    if (plan) this.planAnswered = true;
    if (plan && needsApproval(String(input.plan ?? ''))) {
      return this.s.approvals.ask(toolName, input, opts).then((d) => {
        this.planDenied = d.behavior === 'deny';
        return d;
      });
    }
    const allow = plan || toolName.endsWith('__set_status');
    return allow ? Promise.resolve({ behavior: 'allow' as const, updatedInput: input }) : null;
  }

  // A plan step that ended without ExitPlanMode takes its approval from the APPROVAL line of the reply; true while the card is open.
  askReplyApproval(reply: string) {
    if (this.s.state.session.loop.phase !== 'plan' || this.planAnswered || !needsApproval(reply)) return false;
    this.planAnswered = true;
    const ctl = (this.replyApproval = new AbortController());
    void this.s.approvals.ask('ExitPlanMode', { plan: reply }, { signal: ctl.signal }).then((d) => {
      if (this.replyApproval !== ctl) return;
      this.replyApproval = null;
      this.planDenied = d.behavior === 'deny';
      if (looping(this.s.state.session.loop) && this.s.state.session.loop.phase === 'plan') this.s.turn.ended();
    });
    return true;
  }

  private cancelReplyApproval() {
    this.replyApproval?.abort();
    this.replyApproval = null;
  }

  end(note: string | null, why = note?.replace(/^Build cycle (?:stopped|passed): /, '') ?? 'ended') {
    this.s.runs.end(this.run, why);
    this.run = undefined;
    this.s.setSession({ loop: { ...this.s.state.session.loop, on: false } });
    if (note) this.s.system(note);
    const { prevModel: model, prevEffort: effort } = this;
    this.prevModel = null;
    this.prevEffort = null;
    const { settings, state } = this.s;
    const back = model && model !== state.session.model ? settings.setModel(model) : Promise.resolve();
    back
      .then(() => (effort && effort !== state.session.effort ? settings.setEffort(effort) : undefined))
      .catch((err) => this.s.system(`Could not switch back after the build cycle: ${errText(err)}`));
  }

  round(before: LoopState, after: LoopState) {
    const { runs, turn } = this.s;
    const run = runs.get(this.run);
    if (!run) return;
    runs.addRound(run.id, { n: (run.rounds.at(-1)?.n ?? 0) + 1, ...phaseRound(before, turn.lastResult, turn.lastError), costUsd: turn.cost });
    runs.update(run.id, { round: after.round });
  }

  interrupted() {
    this.cancelReplyApproval();
    const loop = this.s.state.session.loop;
    if (!looping(loop)) return;
    this.s.setSession({ loop: { ...loop, phase: null } });
    this.end('Build cycle stopped', 'you stopped it');
  }

  // No result comes for the step that was running, so the loop cannot advance.
  exited() {
    this.cancelReplyApproval();
    const loop = this.s.state.session.loop;
    if (!looping(loop)) return;
    this.s.setSession({ loop: { ...loop, phase: 'failed' } });
    this.end(`Build cycle stopped: ${providerLabel(this.s.driver.provider)} exited during the ${loop.phase} step`);
  }
}
