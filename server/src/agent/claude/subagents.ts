import { randomUUID } from 'node:crypto';
import { getSubagentMessages } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, ChatEvent } from '../../../../shared/protocol.js';
import type { AgentHost } from '../types.js';
import { agentResultPatch, unchanged } from './tasks.js';
import { AGENT_TOOLS, finalText, handbackOf, type AgentIds } from './transcript.js';

// A SendMessage that resumes an agent carries its own tool id; follow the link back to the Agent call.
export function agentToolUse(host: AgentHost, toolUseId: string) {
  const link = host.eventById(toolUseId);
  return link?.kind === 'tool_use' && link.agent ? link.agent : toolUseId;
}

export const taskToolUse = (taskIds: Map<string, string>, agents: AgentIds, taskId: string) =>
  [...taskIds].find(([, t]) => t === taskId)?.[0] ?? agents.get(taskId);

export function patchAgent(host: AgentHost, toolUseId: string, patch: (a: AgentEvent) => Partial<AgentEvent>) {
  const a = host.agentOf(toolUseId);
  if (!a) return;
  const next = patch(a);
  if (unchanged(a, next)) return;
  Object.assign(a, next);
  host.emit({ type: 'event', event: a });
}

export function agentResult(host: AgentHost, toolUseId: string, text: string, isError: boolean, output: any) {
  patchAgent(host, toolUseId, agentResultPatch(text, isError, output, Date.now()));
}

export function isAgent(host: AgentHost, toolUseId: string) {
  const use = host.eventById(toolUseId);
  return use?.kind === 'tool_use' && AGENT_TOOLS.has(use.name);
}

const resumed = (host: AgentHost, toolUseId: string, since: number) => host.state.events.some((e) => e.kind === 'tool_use' && e.agent === toolUseId && e.at > since);

export function taskDone(host: AgentHost, agents: AgentIds, toolUseId: string, taskId: string, status: 'completed' | 'failed' | 'stopped', summary: string) {
  const last = [...host.state.events].reverse().find((e) => e.kind === 'tool_result' && e.toolUseId === toolUseId);
  if (last && !resumed(host, toolUseId, last.at)) return;
  const ev: Extract<ChatEvent, { kind: 'tool_result' }> = { id: randomUUID(), kind: 'tool_result', toolUseId, text: summary, isError: status === 'failed', at: Date.now(), ...(status === 'stopped' && { stopped: true }) };
  host.pushEvent(ev);
  const sessionId = host.state.session.sessionId;
  if (!sessionId || !isAgent(host, toolUseId) || status !== 'completed') return;
  const agentId = [...agents].find(([, t]) => t === toolUseId)?.[0] ?? taskId;
  void getSubagentMessages(sessionId, agentId, { dir: host.cwd }).catch(() => []).then((sub) => {
    const text = handbackOf(sub) ?? finalText(sub);
    if (!text) return;
    ev.text = text;
    host.emit({ type: 'event', event: ev });
  });
}
