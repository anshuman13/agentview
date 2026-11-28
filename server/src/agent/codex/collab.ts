import type { AgentEvent, AgentStatus, ChatEvent } from '../../../../shared/protocol.js';
import type { AgentHost } from '../types.js';
import { clipResult, toolUseEvent } from '../steps.js';
import type { CollabAgentState, CollabItem, Thread } from './protocol.js';

type Sink = Pick<AgentHost, 'pushEvent' | 'emit' | 'agentOf'>;

// A receiver thread: the Agent step it belongs to (null until its spawn is known) and the steps that came before that.
type Child = { toolUseId: string | null; early: ChatEvent[] };

const ENDED: Partial<Record<CollabAgentState['status'], AgentStatus>> = { completed: 'done', errored: 'failed', notFound: 'failed', interrupted: 'stopped', shutdown: 'stopped' };

const firstLine = (text: string) => text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

// Codex collab tool calls (spawnAgent, wait, closeAgent, ...) as Agent steps for the Agents pane: each spawned receiver thread is one AgentEvent,
// and the items of that thread are steps with `parent` set to its spawn.
export class CodexCollab {
  private children = new Map<string, Child>();
  // Spawns that have not named their receiver thread yet, oldest first.
  private pending: string[] = [];
  private ended = new Set<string>();

  constructor(private host: Sink) {}

  isChild(threadId: unknown): threadId is string {
    return typeof threadId === 'string' && this.children.has(threadId);
  }

  // The Agent step a thread's own steps nest under; undefined for the chat's thread.
  parentOf(threadId: string | undefined) {
    return threadId ? this.children.get(threadId)?.toolUseId ?? undefined : undefined;
  }

  // `thread/started` for a sub-agent can come before its spawn item names it.
  threadStarted(thread: Thread) {
    if (!thread.parentThreadId || this.children.has(thread.id)) return;
    this.children.set(thread.id, { toolUseId: null, early: [] });
    this.match();
  }

  // A step of a receiver thread, held back until the thread's spawn is known.
  step(threadId: string, ev: ChatEvent) {
    const c = this.children.get(threadId);
    if (!c) return;
    if (c.toolUseId) this.host.pushEvent({ ...ev, parent: c.toolUseId } as ChatEvent);
    else c.early.push(ev);
  }

  started(item: CollabItem, at: number) {
    const parent = this.parentOf(item.senderThreadId);
    if (item.tool !== 'spawnAgent') return this.host.pushEvent(toolUseEvent(item.id, item.tool, { targets: item.receiverThreadIds, ...(item.prompt && { prompt: item.prompt }) }, at, parent));
    const prompt = item.prompt ?? '';
    const model = [item.model, item.reasoningEffort].filter(Boolean).join(' ') || null;
    this.host.pushEvent(toolUseEvent(item.id, 'Agent', { description: firstLine(prompt), prompt, ...(item.model && { model: item.model }), ...(item.reasoningEffort && { reasoning_effort: item.reasoningEffort }) }, at, parent));
    const agent: AgentEvent = { id: `${item.id}:agent`, kind: 'agent', toolUseId: item.id, description: firstLine(prompt) || 'Codex agent', subagentType: 'general-purpose', model, background: true, prompt, status: 'running', startedAt: at, endedAt: null, progress: null, usage: null, at, ...(parent && { parent }) };
    this.host.pushEvent(agent);
    if (item.receiverThreadIds.length) this.bind(item.receiverThreadIds[0], item.id);
    else {
      this.pending.push(item.id);
      this.match();
    }
    this.states(item, at);
  }

  completed(item: CollabItem, at: number) {
    if (item.tool === 'spawnAgent') {
      const receiver = item.receiverThreadIds[0];
      if (receiver && this.pending.includes(item.id)) this.bind(receiver, item.id);
      if (item.status === 'failed') this.end(item.id, 'failed', 'Codex could not start the agent', at);
    } else {
      const text = Object.entries(item.agentsStates ?? {}).map(([t, s]) => `${t}: ${s.status}${s.message ? `\n${s.message}` : ''}`).join('\n');
      const parent = this.parentOf(item.senderThreadId);
      this.host.pushEvent({ id: `${item.id}:result`, kind: 'tool_result', toolUseId: item.id, text: clipResult(text), isError: item.status === 'failed', at, ...(parent && { parent }) });
    }
    this.states(item, at);
  }

  private states(item: CollabItem, at: number) {
    for (const [threadId, state] of Object.entries(item.agentsStates ?? {})) {
      if (!this.children.has(threadId)) this.children.set(threadId, { toolUseId: null, early: [] });
      const toolUseId = this.children.get(threadId)!.toolUseId;
      const status = ENDED[state.status];
      if (status && toolUseId) this.end(toolUseId, status, state.message ?? '', at);
    }
  }

  // The agent's end: its status and end time on the AgentEvent, and its report as the result of the Agent step.
  private end(toolUseId: string, status: AgentStatus, text: string, at: number) {
    if (this.ended.has(toolUseId)) return;
    this.ended.add(toolUseId);
    const a = this.host.agentOf(toolUseId);
    if (a) {
      Object.assign(a, { status, endedAt: at });
      this.host.emit({ type: 'event', event: a });
    }
    const parent = a?.parent;
    this.host.pushEvent({ id: `${toolUseId}:result`, kind: 'tool_result', toolUseId, text: clipResult(text || `Agent ${status}`), isError: status === 'failed', at, ...(parent && { parent }), ...(status === 'stopped' && { stopped: true }) });
  }

  private bind(threadId: string, toolUseId: string) {
    this.pending = this.pending.filter((id) => id !== toolUseId);
    const c = this.children.get(threadId) ?? { toolUseId: null, early: [] };
    if (c.toolUseId) return;
    c.toolUseId = toolUseId;
    this.children.set(threadId, c);
    for (const ev of c.early.splice(0)) this.step(threadId, ev);
  }

  // An unnamed spawn and an unclaimed sub-agent thread are paired in order.
  private match() {
    for (const [threadId, c] of this.children) {
      if (!this.pending.length) return;
      if (!c.toolUseId) this.bind(threadId, this.pending[0]);
    }
  }
}
