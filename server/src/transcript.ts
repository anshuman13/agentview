import { randomUUID } from 'node:crypto';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CacheInfo, ChatEvent } from '../../shared/protocol.js';

export const BIG_BRO = 'big-bro';

const COMPACT_SUMMARY = 'This session is being continued from a previous conversation';
export const ASYNC_LAUNCH = 'Async agent launched';

export function historyFrom(msgs: SessionMessage[], subagents: Record<string, SessionMessage[]> = {}) {
  const events: ChatEvent[] = [];
  let context: number | null = null;
  let cache: CacheInfo | null = null;
  let lastText = '';
  let lastAt = 0;
  let inTurn = false;
  const endTurn = () => {
    if (inTurn) events.push({ id: randomUUID(), kind: 'result', text: lastText, costUsd: 0, isError: false, at: lastAt });
    inTurn = false;
  };
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    const at = Date.parse((m as { timestamp?: string }).timestamp ?? '') || 0;
    const content = (m.message as { content?: unknown })?.content;
    const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (m.type === 'user' && b.type === 'text' && b.text.startsWith('<task-notification>')) {
        const done = notificationResult(b.text, at);
        if (done) events.push(done);
      } else if (m.type === 'user' && b.type === 'text' && b.text.includes('<local-command-stdout>Compacted')) {
        context = null;
      } else if (m.type === 'user' && b.type === 'text' && b.text.startsWith(COMPACT_SUMMARY)) {
        events.push({ id: randomUUID(), kind: 'system', text: 'Compacted the earlier conversation', at });
      } else if (m.type === 'user' && b.type === 'text' && b.text.startsWith('[Request interrupted')) {
        events.push({ id: randomUUID(), kind: 'system', text: 'Interrupted', at });
      } else if (m.type === 'user' && b.type === 'text' && !b.text.trimStart().startsWith('<')) {
        endTurn();
        inTurn = true;
        events.push({ id: randomUUID(), kind: 'user', text: b.text, at });
      } else if (m.type === 'user' && b.type === 'tool_result') {
        const text = toolResultText(b);
        if (!text.startsWith(ASYNC_LAUNCH)) events.push({ id: randomUUID(), kind: 'tool_result', toolUseId: b.tool_use_id, text: text.slice(0, 4000), isError: Boolean(b.is_error), at });
      } else if (m.type === 'assistant' && b.type === 'text') {
        lastText = b.text;
        events.push({ id: randomUUID(), kind: 'assistant', text: b.text, streaming: false, at });
      } else if (m.type === 'assistant' && b.type === 'server_tool_use' && b.name === 'advisor') {
        events.push(advisorEvent(b.id, at));
      } else if (m.type === 'assistant' && b.type === 'tool_use') {
        events.push(toolUseEvent(b.id, b.name, b.input, at));
      }
    }
    if (at) lastAt = at;
    if (m.type === 'assistant' && at) cache = cacheFrom((m.message as any)?.usage, at, cache);
    if (m.type === 'assistant') context = contextFrom((m.message as any)?.usage) ?? context;
  }
  endTurn();
  for (const [parent, sub] of Object.entries(subagents)) events.push(...subagentEvents(sub, parent));
  return { events, context, cache };
}

function subagentEvents(msgs: SessionMessage[], parent: string) {
  const events: ChatEvent[] = [];
  for (const m of msgs) {
    const at = Date.parse((m as { timestamp?: string }).timestamp ?? '') || 0;
    const content = (m.message as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (m.type === 'assistant' && b.type === 'tool_use') events.push(toolUseEvent(b.id, b.name, b.input, at, parent));
      else if (m.type === 'user' && b.type === 'tool_result') events.push({ id: randomUUID(), kind: 'tool_result', toolUseId: b.tool_use_id, text: toolResultText(b).slice(0, 4000), isError: Boolean(b.is_error), at, parent });
    }
  }
  return events;
}

const tag = (text: string, name: string) => text.match(new RegExp(`<${name}>([\\s\\S]*)</${name}>`))?.[1]?.trim();

export function notificationResult(text: string, at: number): ChatEvent | null {
  const toolUseId = tag(text, 'tool-use-id');
  if (!toolUseId) return null;
  const result = tag(text, 'result') ?? tag(text, 'summary') ?? '';
  return { id: randomUUID(), kind: 'tool_result', toolUseId, text: result.slice(0, 4000), isError: tag(text, 'status') === 'failed', at };
}

export function advisorEvent(id: string, at: number): ChatEvent {
  return { id, kind: 'tool_use', name: 'Advisor', input: {}, summary: 'Consulted the advisor', at };
}

export function toolUseEvent(id: string, name: string, rawInput: unknown, at: number, parent?: string): ChatEvent {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  return { id, kind: 'tool_use', name, input, summary: summarizeTool(name, input), at, ...(parent && { parent }) };
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
