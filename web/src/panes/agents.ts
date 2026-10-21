import type { AgentEvent, AgentStatus, ChatEvent } from '../../../shared/protocol';
import { buildTranscript, firstLine, stepLabel, type Item, type ToolResult, type ToolUse } from './steps';

export type Agent = {
  id: string;
  use: ToolUse;
  info?: AgentEvent;
  result?: ToolResult;
  steps: Item[];
  description: string;
  type: string;
  model: string | null;
  prompt: string;
  status: AgentStatus;
  startedAt: number;
  endedAt: number | null;
  lastStep: string;
};

function stepText(it: Item | undefined): string {
  if (!it) return '';
  if (it.kind === 'step' || it.kind === 'agent') {
    const { verb, object } = stepLabel(it.use.name, it.use.input);
    return [verb, object].filter(Boolean).join(' ');
  }
  if (it.kind === 'file') return `Edited ${it.path.split('/').pop()}`;
  if (it.kind === 'assistant' || it.kind === 'system') return firstLine(it.text);
  return '';
}

function agentOf(it: Extract<Item, { kind: 'agent' }>, info?: AgentEvent): Agent {
  const { use, result, steps, running } = it;
  const s = (k: string) => (typeof use.input[k] === 'string' ? (use.input[k] as string) : '');
  const ended: AgentStatus = result?.stopped ? 'stopped' : result?.isError ? 'failed' : 'done';
  return {
    id: use.id,
    use,
    info,
    result,
    steps,
    description: info?.description || s('description') || 'Sub-agent',
    type: info?.subagentType || s('subagent_type') || 'general-purpose',
    model: info?.model ?? (s('model') || null),
    prompt: info?.prompt || s('prompt'),
    status: running ? 'running' : info && info.status !== 'running' ? info.status : ended,
    startedAt: info?.startedAt ?? use.at,
    endedAt: running ? null : info?.endedAt ?? result?.at ?? null,
    lastStep: stepText(steps[steps.length - 1]),
  };
}

export function buildAgents(events: ChatEvent[]): Agent[] {
  const info = new Map<string, AgentEvent>();
  for (const e of events) if (e.kind === 'agent') info.set(e.toolUseId, e);
  const out: Agent[] = [];
  const walk = (items: Item[]) => {
    for (const it of items) {
      if (it.kind !== 'agent') continue;
      out.push(agentOf(it, info.get(it.id)));
      walk(it.steps);
    }
  };
  walk(buildTranscript(events));
  return out;
}

export function agentCounts(agents: Agent[]) {
  const running = agents.filter((a) => a.status === 'running').length;
  return { running, done: agents.length - running };
}

let cache: { events: ChatEvent[]; agents: Agent[] } | null = null;
export function agentsOf(events: ChatEvent[]) {
  if (cache?.events !== events) cache = { events, agents: buildAgents(events) };
  return cache.agents;
}

export function elapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const tokens = (n: number) => (n < 1000 ? `${n} tokens` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k tokens`);
