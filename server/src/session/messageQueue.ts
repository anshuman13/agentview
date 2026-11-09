import type { ChatEvent } from '../../../shared/protocol.js';

export type UserEvent = Extract<ChatEvent, { kind: 'user' }>;

export class MessageQueue {
  // Waiting behind a turn; sent when it ends.
  queued: UserEvent[] = [];
  // Sent to Claude mid-turn, shown as waiting until Claude reaches its next step.
  pending: UserEvent[] = [];

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
}
