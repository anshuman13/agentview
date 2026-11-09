import { randomUUID } from 'node:crypto';
import { expandChatMentions } from './chatMentions.js';
import type { UserEvent } from './messageQueue.js';
import type { AgentSession } from './session.js';

export class Prompts {
  constructor(private s: AgentSession) {}

  // A client resends a message it got no echo for; the id tells a repeat from a new message.
  private known(id: string) {
    return this.s.log.get(id) !== undefined;
  }

  private loopCommand(text: string, id: string) {
    return this.s.repeater.command(text, () => this.s.pushEvent({ id, kind: 'user', text, at: Date.now() }));
  }

  orQueue(text: string) {
    if (this.s.state.session.running) this.s.waiting.queue(text, randomUUID());
    else this.s.sendPrompt(text);
  }

  async prompt(text: string, id: string = randomUUID()) {
    const { state, waiting, settings, cycle } = this.s;
    if (this.known(id)) return;
    if (this.loopCommand(text, id)) return;
    if (state.session.running) return waiting.queue(text, id);
    if (!(await settings.planFirst())) return waiting.queue(text, id);
    // Another prompt may have started a turn while plan mode was being set.
    if (state.session.running) return waiting.queue(text, id);
    if (state.session.loop.on && !text.trim().startsWith('/')) return cycle.start(text, id);
    this.s.sendPrompt(text, id);
  }

  async retryLast() {
    const last = this.s.state.events.filter((e): e is UserEvent => e.kind === 'user').at(-1);
    if (!last || !last.text.trim() || last.text.trim().startsWith('/') || this.s.state.session.running) throw new Error('Nothing to retry');
    return this.prompt(last.text);
  }

  // The composer's Enter while Claude works: Claude reads it at its next step and keeps going.
  async queueNext(text: string, id: string = randomUUID()) {
    if (this.known(id)) return;
    const { running, compacting, loop } = this.s.state.session;
    if (!running || compacting || loop.on || text.trim().startsWith('/') || !this.s.driver.attached) return this.prompt(text, id);
    this.s.waiting.holdMidTurn(text, id);
    this.s.driver.send(expandChatMentions(text), id, 'next');
  }

  // Stops the current step so a waiting message runs now.
  async sendNow(id: string) {
    const { waiting, log, stopper, state } = this.s;
    const held = waiting.takeQueued(id);
    if (held) {
      log.remove((e) => e === held);
      return this.steer(held.text);
    }
    if (!waiting.hasPending(id) || state.session.stopping) return;
    await stopper.stop();
  }

  async steer(text: string, id: string = randomUUID()) {
    const { state, waiting, approvals, turn, driver, settings, log } = this.s;
    if (this.known(id)) return;
    if (this.loopCommand(text, id)) return;
    if (state.session.compacting) return waiting.queue(text, id);
    const running = state.session.running;
    const ev: UserEvent = { id, kind: 'user', text, at: Date.now(), stopping: running };
    this.s.pushEvent(ev);
    if (running) {
      waiting.release();
      approvals.denyAll('The user sent a new message instead of answering.');
      turn.start();
      await driver.interrupt().catch(() => {});
      turn.finish();
      ev.stopping = false;
      this.s.emit({ type: 'event', event: ev });
    } else if (!(await settings.planFirst())) {
      log.remove((e) => e === ev);
      return waiting.queue(text, id);
    }
    this.s.enqueue(text, id);
  }
}
