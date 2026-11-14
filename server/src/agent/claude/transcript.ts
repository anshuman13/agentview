import { randomUUID } from 'node:crypto';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { WorkflowRun } from './history.js';
import { clipInput, clipResult, toolUseEvent, type AgentIds } from '../steps.js';

export type { AgentIds };
import { type AgentEvent, type AgentUsage, type CacheInfo, type ChatEvent } from '../../../../shared/protocol.js';

const COMPACT_SUMMARY = 'This session is being continued from a previous conversation';
export const RUN_ID = /Run ID: (wf_[\w-]+)/;
export const ASYNC_LAUNCH = 'Async agent launched';
export const AGENT_TOOLS = new Set(['Agent', 'Task']);
const TRAILER = /\s*agentId: \w+[^\n]*\n<usage>[\s\S]*<\/usage>\s*$/;
const HANDBACK = /^Another Claude session sent a message:\n<agent-message from="(\w+)">\n\[Subagent hand-back\][^\n]*\n([\s\S]*?)\n<\/agent-message>/;


export function noteLaunch(agents: AgentIds, toolUseId: string, text: string) {
  const id = text.match(/agentId: (\w+)/)?.[1];
  if (id) agents.set(id, toolUseId);
}

type Subagents = Record<string, SessionMessage[]>;

type HistoryState = {
  events: ChatEvent[];
  context: number | null;
  cache: CacheInfo | null;
  lastText: string;
  lastAt: number;
  inTurn: boolean;
  prev: string;
  agents: AgentIds;
  agentUses: Set<string>;
  usages: Map<string, AgentUsage>;
  handedBack: Set<string>;
  workflowCalls: Map<string, { name: string; at: number }>;
  runCalls: Map<string, string>;
  subagents: Subagents;
};

function endTurn(st: HistoryState) {
  if (st.inTurn) st.events.push({ id: `${st.prev}:result`, kind: 'result', text: st.lastText, costUsd: 0, isError: false, at: st.lastAt });
  st.inTurn = false;
}

function taskNotificationBlock(st: HistoryState, text: string, at: number, id: string) {
  const usage = usageFrom(text);
  for (const e of notificationResults(text, at, st.agents, id)) {
    if (e.kind !== 'tool_result') continue;
    // A CLI restart reports an agent that already handed back as stopped.
    if (e.stopped && st.handedBack.has(e.toolUseId)) continue;
    if (usage) st.usages.set(e.toolUseId, usage);
    st.events.push(st.subagents[e.toolUseId] ? { ...e, text: agentReport(e.text, st.subagents[e.toolUseId]) } : e);
  }
}

function handbackBlock(st: HistoryState, text: string, at: number, id: string) {
  const [, agentId, report] = text.match(HANDBACK)!;
  const toolUseId = st.agents.get(agentId);
  if (!toolUseId) return;
  st.handedBack.add(toolUseId);
  st.events.push({ id, kind: 'tool_result', toolUseId, text: report.replace(/^  /gm, '').trim(), isError: false, at });
}

function userTextBlock(st: HistoryState, text: string, at: number, id: string) {
  if (text.startsWith('<task-notification>')) taskNotificationBlock(st, text, at, id);
  else if (HANDBACK.test(text)) handbackBlock(st, text, at, id);
  else if (text.includes('<local-command-stdout>Compacted')) st.context = null;
  else if (text.startsWith(COMPACT_SUMMARY)) st.events.push({ id, kind: 'system', text: 'Compacted the earlier conversation', at });
  else if (text.startsWith('[Request interrupted')) st.events.push({ id, kind: 'system', text: 'Interrupted', at });
  else if (!text.trimStart().startsWith('<')) {
    endTurn(st);
    st.inTurn = true;
    st.events.push({ id, kind: 'user', text, at });
  }
}

function toolResultBlock(st: HistoryState, b: any, at: number, id: string) {
  const text = toolResultText(b);
  const runId = st.workflowCalls.has(b.tool_use_id) ? text.match(RUN_ID)?.[1] : undefined;
  if (runId) st.runCalls.set(runId, b.tool_use_id);
  if (text.startsWith(ASYNC_LAUNCH)) return noteLaunch(st.agents, b.tool_use_id, text);
  if (!st.agentUses.has(b.tool_use_id)) return st.events.push({ id, kind: 'tool_result', toolUseId: b.tool_use_id, text: clipResult(text), isError: Boolean(b.is_error), at });
  const usage = usageFrom(text);
  if (usage) st.usages.set(b.tool_use_id, usage);
  st.events.push({ id, kind: 'tool_result', toolUseId: b.tool_use_id, text: agentReport(text, st.subagents[b.tool_use_id]), isError: Boolean(b.is_error), at });
}

function assistantBlock(st: HistoryState, b: any, at: number, id: string) {
  if (b.type === 'text') {
    st.lastText = b.text;
    st.events.push({ id, kind: 'assistant', text: b.text, streaming: false, at });
  } else if (b.type === 'server_tool_use' && b.name === 'advisor') {
    st.events.push(advisorEvent(b.id, at));
  } else if (b.type === 'tool_use') {
    if (AGENT_TOOLS.has(b.name)) st.agentUses.add(b.id);
    if (b.name === 'Workflow') st.workflowCalls.set(b.id, { name: workflowName(b.input), at });
    st.events.push(toolUseEvent(b.id, b.name, b.input, at, undefined, st.agents));
  }
}

function messageBlocks(m: SessionMessage): any[] {
  const content = (m.message as { content?: unknown })?.content;
  return typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
}

function readMessage(st: HistoryState, m: SessionMessage) {
  const at = stamp(m);
  const base = m.uuid || randomUUID();
  for (const [i, b] of messageBlocks(m).entries()) {
    const id = `${base}:${i}`;
    if (m.type === 'user' && b.type === 'text') userTextBlock(st, b.text, at, id);
    else if (m.type === 'user' && b.type === 'tool_result') toolResultBlock(st, b, at, id);
    else if (m.type === 'assistant') assistantBlock(st, b, at, id);
  }
  st.prev = base;
  if (at) st.lastAt = at;
  if (m.type === 'assistant' && at) st.cache = cacheFrom((m.message as any)?.usage, at, st.cache);
  if (m.type === 'assistant') st.context = contextFrom((m.message as any)?.usage) ?? st.context;
}

function withWorkflowRuns(st: HistoryState, events: ChatEvent[], workflows: WorkflowRun[]) {
  const byCall = new Map<string, WorkflowRun[]>();
  for (const run of workflows) {
    const call = st.runCalls.get(run.runId);
    if (call) byCall.set(call, [...(byCall.get(call) ?? []), run]);
  }
  return events.flatMap((e) => (e.kind === 'tool_use' ? [e, ...(byCall.get(e.id) ?? []).flatMap((run) => workflowEvents(run, st.workflowCalls.get(e.id)!.name, e.at))] : [e]));
}

export function historyFrom(msgs: SessionMessage[], subagents: Subagents = {}, workflows: WorkflowRun[] = []) {
  const st: HistoryState = {
    events: [], context: null, cache: null, lastText: '', lastAt: 0, inTurn: false, prev: '',
    agents: new Map(), agentUses: new Set(), usages: new Map(), handedBack: new Set(), workflowCalls: new Map(), runCalls: new Map(), subagents,
  };
  for (const m of msgs) {
    if (!m.parent_tool_use_id) readMessage(st, m);
  }
  endTurn(st);
  for (const [parent, sub] of Object.entries(subagents)) st.events.push(...subagentEvents(sub, parent, subagents));
  const all = withWorkflowRuns(st, withAgents(st.events, subagents, st.usages, st.agents), workflows);
  return { events: all, context: st.context, cache: st.cache, agents: st.agents };
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

function derivedUsage(sub: SessionMessage[], startedAt: number, endedAt: number | null): AgentUsage | null {
  if (!sub.length) return null;
  const last = [...sub].reverse().find((m) => m.type === 'assistant');
  const lastUsage = (last?.message as { usage?: any })?.usage;
  const toolUses = sub.reduce((n, m) => n + (m.type === 'assistant' ? blocksOf(m).filter((b) => b.type === 'tool_use').length : 0), 0);
  return { tokens: (contextFrom(lastUsage) ?? 0) + (lastUsage?.output_tokens ?? 0), toolUses, durationMs: (endedAt ?? (stamp(sub.at(-1)!) || startedAt)) - startedAt };
}

export const workflowName = (input: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>;
  const meta = typeof i.script === 'string' ? i.script.match(/name:\s*['"]([^'"]+)['"]/)?.[1] : undefined;
  const file = typeof i.scriptPath === 'string' ? i.scriptPath.split('/').pop()?.replace(/\.[cm]?js$/, '') : undefined;
  return [i.name, i.workflow, meta, file].find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? 'Workflow';
};

export function workflowEvents(run: WorkflowRun, group: string, callAt: number): ChatEvent[] {
  return run.agents.flatMap((a) => {
    const id = `${run.runId}:${a.key}`;
    const first = a.msgs.find((m) => m.type === 'user');
    const content = (first?.message as { content?: unknown })?.content;
    const prompt = typeof content === 'string' ? content : blocksOf(first ?? ({} as SessionMessage)).map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    const startedAt = (a.msgs[0] && stamp(a.msgs[0])) || callAt;
    const running = a.status === 'running';
    const endedAt = running ? null : (a.msgs.length && stamp(a.msgs.at(-1)!)) || startedAt;
    const model = (a.msgs.find((m) => m.type === 'assistant')?.message as { model?: string })?.model;
    const ev = agentEvent(id, { description: a.label, subagent_type: a.phase, prompt, model }, startedAt);
    Object.assign(ev, { group, status: a.status, endedAt, usage: derivedUsage(a.msgs, startedAt, endedAt) });
    const result: ChatEvent[] = running ? [] : [{ id: `${id}:result`, kind: 'tool_result', toolUseId: id, text: (a.result || finalText(a.msgs)).slice(0, 20_000), isError: a.status === 'failed', at: endedAt ?? startedAt, ...(a.status === 'stopped' && { stopped: true }) }];
    return [toolUseEvent(id, 'Agent', { description: a.label, prompt }, startedAt), ev, ...result, ...subagentEvents(a.msgs, id, {})];
  });
}

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
    const model = (sub.find((m) => m.type === 'assistant')?.message as { model?: string })?.model;
    const endedAt = running ? null : result.at;
    const derived = derivedUsage(sub, e.at, endedAt);
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
        events.push({ id: `${base}:${i}`, kind: 'tool_result', toolUseId: b.tool_use_id, text: agentUses.has(b.tool_use_id) ? agentReport(text, subagents[b.tool_use_id]) : clipResult(text), isError: Boolean(b.is_error), at, parent });
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
