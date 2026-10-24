import type { AgentEvent, ChatEvent } from '../../../shared/protocol.js';

export const agentOf = (events: ChatEvent[], toolUseId: string) => events.find((e): e is AgentEvent => e.kind === 'agent' && e.toolUseId === toolUseId);

export const ORPHANED = 'Stopped: this agent was no longer running, so it could not report back.';

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
