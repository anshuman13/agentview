import { randomUUID } from 'node:crypto';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { BIG_BRO, type AgentEvent, type AgentUsage, type CacheInfo, type ChatEvent } from '../../../../shared/protocol.js';

const COMPACT_SUMMARY = 'This session is being continued from a previous conversation';
export const ASYNC_LAUNCH = 'Async agent launched';
export const AGENT_TOOLS = new Set(['Agent', 'Task']);
const TRAILER = /\s*agentId: \w+[^\n]*\n<usage>[\s\S]*<\/usage>\s*$/;

export type AgentIds = Map<string, string>;

export function noteLaunch(agents: AgentIds, toolUseId: string, text: string) {
  const id = text.match(/agentId: (\w+)/)?.[1];
  if (id) agents.set(id, toolUseId);
}

export function historyFrom(msgs: SessionMessage[], subagents: Record<string, SessionMessage[]> = {}) {
  const events: ChatEvent[] = [];
  let context: number | null = null;
  let cache: CacheInfo | null = null;
  let lastText = '';
  let lastAt = 0;
  let inTurn = false;
  const agents: AgentIds = new Map();
  const agentUses = new Set<string>();
  const usages = new Map<string, AgentUsage>();
  let prev = '';
  const endTurn = () => {
    if (inTurn) events.push({ id: `${prev}:result`, kind: 'result', text: lastText, costUsd: 0, isError: false, at: lastAt });
    inTurn = false;
  };
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    const at = stamp(m);
    const base = m.uuid || randomUUID();
    const content = (m.message as { content?: unknown })?.content;
    const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const [i, b] of blocks.entries()) {
      const id = `${base}:${i}`;
      if (m.type === 'user' && b.type === 'text' && b.text.startsWith('<task-notification>')) {
        const usage = usageFrom(b.text);
        for (const e of notificationResults(b.text, at, agents, id)) {
          if (e.kind !== 'tool_result') continue;
          if (usage) usages.set(e.toolUseId, usage);
          events.push(subagents[e.toolUseId] ? { ...e, text: agentReport(e.text, subagents[e.toolUseId]) } : e);
        }
      } else if (m.type === 'user' && b.type === 'text' && b.text.includes('<local-command-stdout>Compacted')) {
        context = null;
      } else if (m.type === 'user' && b.type === 'text' && b.text.startsWith(COMPACT_SUMMARY)) {
        events.push({ id, kind: 'system', text: 'Compacted the earlier conversation', at });
      } else if (m.type === 'user' && b.type === 'text' && b.text.startsWith('[Request interrupted')) {
        events.push({ id, kind: 'system', text: 'Interrupted', at });
      } else if (m.type === 'user' && b.type === 'text' && !b.text.trimStart().startsWith('<')) {
        endTurn();
        inTurn = true;
        events.push({ id, kind: 'user', text: b.text, at });
      } else if (m.type === 'user' && b.type === 'tool_result') {
        const text = toolResultText(b);
        if (text.startsWith(ASYNC_LAUNCH)) noteLaunch(agents, b.tool_use_id, text);
        else if (agentUses.has(b.tool_use_id)) {
          const usage = usageFrom(text);
          if (usage) usages.set(b.tool_use_id, usage);
          events.push({ id, kind: 'tool_result', toolUseId: b.tool_use_id, text: agentReport(text, subagents[b.tool_use_id]), isError: Boolean(b.is_error), at });
        } else events.push({ id, kind: 'tool_result', toolUseId: b.tool_use_id, text: text.slice(0, 4000), isError: Boolean(b.is_error), at });
      } else if (m.type === 'assistant' && b.type === 'text') {
        lastText = b.text;
        events.push({ id, kind: 'assistant', text: b.text, streaming: false, at });
      } else if (m.type === 'assistant' && b.type === 'server_tool_use' && b.name === 'advisor') {
        events.push(advisorEvent(b.id, at));
      } else if (m.type === 'assistant' && b.type === 'tool_use') {
        if (AGENT_TOOLS.has(b.name)) agentUses.add(b.id);
        events.push(toolUseEvent(b.id, b.name, b.input, at, undefined, agents));
      }
    }
    prev = base;
    if (at) lastAt = at;
    if (m.type === 'assistant' && at) cache = cacheFrom((m.message as any)?.usage, at, cache);
    if (m.type === 'assistant') context = contextFrom((m.message as any)?.usage) ?? context;
  }
  endTurn();
  for (const [parent, sub] of Object.entries(subagents)) events.push(...subagentEvents(sub, parent, subagents));
  return { events: withAgents(events, subagents, usages, agents), context, cache, agents };
}

const CLIP = 4096;

// Long strings in tool inputs (whole files in Write and Edit) are cut for the UI; the marker keeps editCount exact.
export function clipInput(v: unknown): unknown {
  if (typeof v === 'string') {
    if (v.length <= CLIP) return v;
    const head = v.slice(0, CLIP);
    const more = v.split('\n').length - head.split('\n').length;
    return more > 0 ? `${head}\n… ${more} more lines` : `${head} …`;
  }
  if (Array.isArray(v)) return v.map(clipInput);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clipInput(x)]));
  return v;
}

export function agentEvent(id: string, rawInput: unknown, at: number, parent?: string): AgentEvent {
  const input = clipInput(rawInput ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  return { id: `${id}:agent`, kind: 'agent', toolUseId: id, description: s('description'), subagentType: s('subagent_type') || 'general-purpose', model: s('model') || null, background: input.run_in_background === true, prompt: s('prompt'), status: 'running', startedAt: at, endedAt: null, progress: null, usage: null, at, ...(parent && { parent }) };
}

export function usageFrom(text: string): AgentUsage | null {
  const m = text.match(/<usage>(?:subagent_tokens|total_tokens): (\d+)\s+tool_uses: (\d+)\s+duration_ms: (\d+)\s*<\/usage>/);
  return m ? { tokens: Number(m[1]), toolUses: Number(m[2]), durationMs: Number(m[3]) } : null;
}

const stamp = (m: SessionMessage) => Date.parse((m as { timestamp?: string }).timestamp ?? '') || 0;

function withAgents(events: ChatEvent[], subagents: Record<string, SessionMessage[]>, usages: Map<string, AgentUsage>, agents: AgentIds) {
  const results = new Map<string, Extract<ChatEvent, { kind: 'tool_result' }>>();
  const resumed = new Map<string, number>();
  for (const e of events) {
    if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    if (e.kind === 'tool_use' && e.agent) resumed.set(e.agent, e.at);
  }
  const launched = new Set(agents.values());
  return events.flatMap((e) => {
    if (e.kind !== 'tool_use' || !AGENT_TOOLS.has(e.name)) return [e];
    const ev = agentEvent(e.id, e.input, e.at, e.parent);
    const sub = subagents[e.id] ?? [];
    const result = results.get(e.id);
    const running = !result || (resumed.get(e.id) ?? 0) > result.at;
    const last = [...sub].reverse().find((m) => m.type === 'assistant');
    const model = (sub.find((m) => m.type === 'assistant')?.message as { model?: string })?.model;
    const endedAt = running ? null : result.at;
    const tools = sub.reduce((n, m) => n + (m.type === 'assistant' ? blocksOf(m).filter((b) => b.type === 'tool_use').length : 0), 0);
    const lastUsage = (last?.message as { usage?: any })?.usage;
    const derived = sub.length ? { tokens: (contextFrom(lastUsage) ?? 0) + (lastUsage?.output_tokens ?? 0), toolUses: tools, durationMs: (endedAt ?? (stamp(sub.at(-1)!) || e.at)) - e.at } : null;
    Object.assign(ev, {
      model: model ?? ev.model,
      background: ev.background || launched.has(e.id),
      status: running ? 'running' : result.stopped ? 'stopped' : result.isError ? 'failed' : 'done',
      endedAt,
      usage: usages.get(e.id) ?? derived,
    });
    return [e, ev];
  });
}

function subagentEvents(msgs: SessionMessage[], parent: string, subagents: Record<string, SessionMessage[]>) {
  const events: ChatEvent[] = [];
  const agentUses = new Set<string>();
  for (const m of msgs) {
    const at = stamp(m);
    const base = m.uuid || randomUUID();
    for (const [i, b] of blocksOf(m).entries()) {
      if (m.type === 'assistant' && b.type === 'text' && b.text.trim()) events.push({ id: `${base}:${i}`, kind: 'assistant', text: b.text, streaming: false, at, parent });
      else if (m.type === 'assistant' && b.type === 'tool_use') {
        if (AGENT_TOOLS.has(b.name)) agentUses.add(b.id);
        events.push(toolUseEvent(b.id, b.name, b.input, at, parent));
      } else if (m.type === 'user' && b.type === 'tool_result') {
        const text = toolResultText(b);
        events.push({ id: randomUUID(), kind: 'tool_result', toolUseId: b.tool_use_id, text: agentUses.has(b.tool_use_id) ? agentReport(text, subagents[b.tool_use_id]) : text.slice(0, 4000), isError: Boolean(b.is_error), at, parent });
      }
    }
  }
  return events;
}

const tag = (text: string, name: string) => text.match(new RegExp(`<${name}>([\\s\\S]*)</${name}>`))?.[1]?.trim();

export function notificationResults(text: string, at: number, agents: AgentIds, base?: string): ChatEvent[] {
  // A resumed agent reports under the SendMessage call's id; the task id still points at the Agent call.
  const byTask = [...text.matchAll(/<task-id>(\w+)<\/task-id>/g)].flatMap((m) => agents.get(m[1]) ?? []);
  const direct = tag(text, 'tool-use-id');
  const ids = byTask.length ? byTask : direct ? [direct] : [];
  const status = tag(text, 'status');
  const result = tag(text, 'result') ?? tag(text, 'summary') ?? '';
  return ids.map((toolUseId) => ({ id: base ? `${base}:${toolUseId}` : randomUUID(), kind: 'tool_result', toolUseId, text: result, isError: status === 'failed', at, ...(status === 'stopped' && { stopped: true }) }));
}

const blocksOf = (m: SessionMessage): any[] => {
  const content = (m.message as { content?: unknown })?.content;
  return Array.isArray(content) ? content : [];
};

export function handbackOf(msgs: SessionMessage[]): string | undefined {
  for (const m of [...msgs].reverse()) {
    const b = blocksOf(m).find((x) => x.type === 'tool_use' && x.name === 'SubagentHandback' && typeof x.input?.message === 'string');
    if (b) return b.input.message;
  }
}

export function finalText(msgs: SessionMessage[]) {
  const last = [...msgs].reverse().find((m) => m.type === 'assistant' && blocksOf(m).some((b) => b.type === 'text' && b.text.trim()));
  return last ? blocksOf(last).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() : '';
}

const stripTrailer = (text: string) => text.replace(TRAILER, '').trim();

function agentReport(text: string, sub?: SessionMessage[]) {
  return (sub && handbackOf(sub)) ?? stripTrailer(text);
}

export function liveReport(text: string, output: any) {
  if (typeof output?.handbackReport?.text === 'string') return output.handbackReport.text as string;
  if (output?.status === 'completed' && Array.isArray(output.content)) return output.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('\n').trim();
  return stripTrailer(text);
}

export function advisorEvent(id: string, at: number): ChatEvent {
  return { id, kind: 'tool_use', name: 'Advisor', input: {}, summary: 'Consulted the advisor', at };
}

export function toolUseEvent(id: string, name: string, rawInput: unknown, at: number, parent?: string, agents?: AgentIds): ChatEvent {
  const input = clipInput(rawInput ?? {}) as Record<string, unknown>;
  const agent = name === 'SendMessage' && typeof input.to === 'string' ? agents?.get(input.to) : undefined;
  return { id, kind: 'tool_use', name, input, summary: summarizeTool(name, input), at, ...(parent && { parent }), ...(agent && { agent }) };
}

export function contextFrom(usage: any): number | null {
  if (!usage) return null;
  const total = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return total > 0 ? total : null;
}

export function cacheFrom(usage: any, at: number, prev: CacheInfo | null): CacheInfo | null {
  if (!usage) return prev;
  const c = usage.cache_creation;
  const ttlMs = c?.ephemeral_1h_input_tokens > 0 ? 3_600_000 : c?.ephemeral_5m_input_tokens > 0 ? 300_000 : prev?.ttlMs ?? 300_000;
  return { at, ttlMs, readTokens: usage.cache_read_input_tokens ?? 0, writeTokens: usage.cache_creation_input_tokens ?? 0 };
}

export function toolResultText(block: { content?: unknown }): string {
  if (typeof block.content === 'string') return block.content;
  return ((block.content as any[]) ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}

function summarizeTool(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return `${name} ${s(input.file_path)}`;
    case 'Bash':
      return s(input.description) || `$ ${s(input.command).slice(0, 120)}`;
    case 'Grep':
      return `grep ${s(input.pattern)}`;
    case 'Glob':
      return `glob ${s(input.pattern)}`;
    case 'AskUserQuestion':
      return 'Asked you a question';
    case 'Agent':
    case 'Task':
      return input.subagent_type === BIG_BRO ? `Asked Fable: ${s(input.description)}` : `Agent: ${s(input.description)}`;
    default:
      return name;
  }
}
