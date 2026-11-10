import type { ChatEvent, ServerMessage, ServerState } from '../../../shared/protocol.js';
import { ROW_WINDOW } from '../../../shared/protocol.js';
import type { History } from '../agent/types.js';
import { EventIndex, MAX_EVENTS, stopAgents, trimHistory } from './events.js';
import { prFrom } from './pr.js';

export class EventLog {
  private index = new EventIndex(() => this.state.events);
  private orphans = new Set<string>();

  constructor(private state: ServerState, private emit: (m: ServerMessage) => void, private push: (ev: ChatEvent) => void) {}

  add(ev: ChatEvent) {
    this.state.events.push(ev);
    this.index.pushed(ev);
    if (this.state.events.length > MAX_EVENTS + 500) this.state.events = trimHistory(this.state.events);
  }

  get(id: string) {
    return this.index.get(id);
  }

  agent(toolUseId: string) {
    return this.index.agent(toolUseId);
  }

  window(limit?: number) {
    if (limit === undefined || this.state.events.length <= limit) return this.state;
    return { ...this.state, events: this.state.events.slice(-limit), earlier: this.state.events.length - limit };
  }

  // The page of events right before one, oldest first, and how many are left before it.
  before(id: string, limit = ROW_WINDOW) {
    const at = this.state.events.findIndex((e) => e.id === id);
    if (at < 0) throw new Error('That event is no longer held');
    const start = Math.max(0, at - Math.min(Math.max(Math.floor(limit), 1), 500));
    return { events: this.state.events.slice(start, at), earlier: start };
  }

  // The tail only: a client that paged in older events keeps them while their count still adds up (see mergeTail).
  private reinit() {
    this.emit({ type: 'init', state: this.window(ROW_WINDOW) });
  }

  remove(drop: (e: ChatEvent) => boolean) {
    this.state.events = this.state.events.filter((e) => !drop(e));
    this.reinit();
  }

  // The events move below the finished turn, in the order given.
  moveToEnd(tail: ChatEvent[]) {
    const moved = new Set(tail);
    this.state.events = [...this.state.events.filter((e) => !moved.has(e)), ...tail];
    this.reinit();
  }

  allow(rule: string) {
    for (const e of this.state.events) {
      if (e.kind === 'blocked' && e.rule === rule && !e.allowed) {
        e.allowed = true;
        this.emit({ type: 'event', event: e });
      }
    }
  }

  replace(h: History) {
    this.state.events = this.apply(h);
    this.reinit();
  }

  append(h: History) {
    this.state.events.push(...this.apply(h));
  }

  private apply({ events, context, cache }: History) {
    Object.assign(this.state.session, { context, cache, pr: prFrom(events) ?? this.state.session.pr });
    const kept = trimHistory(events);
    return [...kept, ...stopAgents(kept, this.orphans, Date.now())];
  }

  orphan(ids: string[]) {
    for (const id of ids) this.orphans.add(id);
    for (const ev of stopAgents(this.state.events, ids, Date.now())) {
      this.emit({ type: 'event', event: this.index.agent((ev as { toolUseId: string }).toolUseId)! });
      this.push(ev);
    }
  }

  orphanRunning() {
    this.orphan(this.state.events.flatMap((e) => (e.kind === 'agent' && e.status === 'running' ? [e.toolUseId] : [])));
  }

  adopt(toolUseId: string) {
    this.orphans.delete(toolUseId);
  }
}
