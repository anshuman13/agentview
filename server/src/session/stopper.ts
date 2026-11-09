import type { AgentSession } from './session.js';

const STOP_TIMEOUT = 15_000;

export class Stopper {
  private timer: NodeJS.Timeout | undefined;

  constructor(private s: AgentSession) {}

  close() {
    clearTimeout(this.timer);
  }

  async stop(cancelQueued = false) {
    const s = this.s;
    s.setSession({ stopping: true });
    try {
      await s.driver.interrupt(cancelQueued);
      // A CLI stuck in a tool (such as a macOS privacy prompt) never ends the turn, so end the process.
      this.timer = setTimeout(() => {
        if (!s.state.session.stopping) return;
        s.system('Claude did not stop, so its process was ended');
        s.driver.kill();
      }, STOP_TIMEOUT);
      this.timer.unref?.();
    } catch (err) {
      s.setSession({ stopping: false });
      s.system(`Stop failed: ${String(err)}`);
    }
  }

  async interrupt() {
    const { driver, state, turn, cycle, waiting, repeater } = this.s;
    if (!driver.attached || !state.session.running || state.session.stopping) return;
    turn.takePlanChange();
    cycle.interrupted();
    const idle = turn.drop(driver.dropInput());
    waiting.dropQueued();
    waiting.dropPending();
    if (idle) {
      this.s.setSession({ running: false, compacting: false });
      repeater.defer();
      return;
    }
    await this.stop(true);
  }

  async task(toolUseId: string) {
    const { driver, state, log } = this.s;
    if (await driver.stopTask(toolUseId)) return;
    const a = log.agent(toolUseId);
    if (!a || a.status !== 'running') return;
    if (driver.attached && state.session.running && !a.background) return this.interrupt();
    log.orphan([toolUseId]);
  }
}
