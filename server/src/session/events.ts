import { randomUUID } from 'node:crypto';
import type { AgentEvent, ChatEvent } from '../../../shared/protocol.js';

export const agentOf = (events: ChatEvent[], toolUseId: string) => events.find((e): e is AgentEvent => e.kind === 'agent' && e.toolUseId === toolUseId);

// Id lookups over an events array. pushEvent adds to it; a replaced array or a changed length (trim, filter, reorder) rebuilds it on the next read.
export class EventIndex {
  private arr: ChatEvent[] | null = null;
  private n = 0;
  private byId = new Map<string, ChatEvent>();
  private agents = new Map<string, AgentEvent>();

  constructor(private source: () => ChatEvent[]) {}

  private sync() {
    const events = this.source();
    if (events === this.arr && events.length === this.n) return;
    this.byId.clear();
    this.agents.clear();
    for (const e of events) this.add(e);
    this.arr = events;
    this.n = events.length;
  }

  private add(e: ChatEvent) {
    if (!this.byId.has(e.id)) this.byId.set(e.id, e);
    if (e.kind === 'agent' && !this.agents.has(e.toolUseId)) this.agents.set(e.toolUseId, e);
  }

  pushed(e: ChatEvent) {
    const events = this.source();
    if (events === this.arr && events.length === this.n + 1) {
      this.add(e);
      this.n++;
    }
  }

  get(id: string) {
    this.sync();
    return this.byId.get(id);
  }

  agent(toolUseId: string) {
    this.sync();
    return this.agents.get(toolUseId);
  }
}

const ORPHANED = 'Stopped: this agent was no longer running, so it could not report back.';

// Agents whose task is gone (process ended, server restarted) never get a completion: end them as stopped.
export function stopAgents(events: ChatEvent[], ids: Iterable<string>, at: number, text = ORPHANED): ChatEvent[] {
  const want = new Set(ids);
  const out: ChatEvent[] = [];
  for (const e of events) {
    if (e.kind !== 'agent' || e.status !== 'running' || !want.has(e.toolUseId)) continue;
    Object.assign(e, { status: 'stopped', endedAt: at });
    out.push({ id: `${e.toolUseId}:stopped`, kind: 'tool_result', toolUseId: e.toolUseId, text, isError: false, at, stopped: true, ...(e.parent && { parent: e.parent }) });
  }
  return out;
}

export const MAX_EVENTS = 3000;
// A chat keeps its last few thousand events; the CLI transcript still has everything.
export function trimHistory(events: ChatEvent[]) {
  if (events.length <= MAX_EVENTS) return events;
  const kept = events.slice(-MAX_EVENTS);
  return [{ id: randomUUID(), kind: 'system' as const, text: `${events.length - MAX_EVENTS} older events are not shown`, at: kept[0].at }, ...kept];
}
