import type { ChatEvent } from '../../../shared/protocol.js';
import type { AgentSession } from './session.js';

export type UserEvent = Extract<ChatEvent, { kind: 'user' }>;

export class MessageQueue {
  // Waiting behind a turn; sent when it ends.
  queued: UserEvent[] = [];
  // Sent to Claude mid-turn, shown as waiting until Claude reaches its next step.
  pending: UserEvent[] = [];

  constructor(private s: AgentSession) {}

  get messages() {
    return this.queued.map(({ id, text }) => ({ id, text }));
  }

  takeQueued(id: string) {
    const held = this.queued.find((e) => e.id === id);
    if (held) this.queued = this.queued.filter((e) => e !== held);
    return held;
  }

  hasPending(id: string) {
    return this.pending.some((e) => e.id === id);
  }

  takePending() {
    return this.pending.splice(0);
  }

  clearQueued() {
    const ids = new Set(this.queued.map((e) => e.id));
    this.queued = [];
    return ids;
  }

  requeuePending() {
    this.queued.unshift(...this.takePending());
  }

  queue(text: string, id: string) {
    this.hold(this.queued, text, id);
  }

  holdMidTurn(text: string, id: string) {
    this.hold(this.pending, text, id);
  }

  private hold(list: UserEvent[], text: string, id: string) {
    const ev: UserEvent = { id, kind: 'user', text, at: Date.now(), queued: true };
    list.push(ev);
    this.s.pushEvent(ev);
  }

  release() {
    for (const ev of this.takePending()) {
      ev.queued = false;
      this.s.emit({ type: 'event', event: ev });
    }
  }

  dropQueued() {
    if (!this.queued.length) return;
    const ids = this.clearQueued();
    this.s.log.remove((e) => ids.has(e.id));
  }

  dropPending() {
    const dropped = new Set(this.takePending());
    if (dropped.size) this.s.log.remove((e) => dropped.has(e as UserEvent));
  }

  // The sent message and the ones still waiting move below the finished turn, in the order they were typed.
  dequeue() {
    const ev = this.queued.shift();
    if (!ev) return false;
    ev.queued = false;
    ev.at = Date.now();
    this.s.log.moveToEnd([ev, ...this.queued]);
    this.s.enqueue(ev.text, ev.id);
    return true;
  }
}
