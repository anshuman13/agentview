import type { ChatEvent } from '../../../../shared/protocol.js';
import { toolUseEvent } from '../claude/transcript.js';
import type { FileUpdateChange, ThreadItem, Turn } from './protocol.js';

const MAX_RESULT = 4000;
const DENIED = 'User denied this action in the AgentView UI.';

// A unified diff as the text it removes and the text it adds, so a file change reads like an Edit. A diff without hunks is the whole file.
export function splitDiff(diff: string): { before: string; after: string } {
  if (!/^@@/m.test(diff)) return { before: '', after: diff };
  const before: string[] = [];
  const after: string[] = [];
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && line.startsWith('-')) before.push(line.slice(1));
    else if (inHunk && line.startsWith('+')) after.push(line.slice(1));
  }
  return { before: before.join('\n'), after: after.join('\n') };
}

export const changeText = (c: FileUpdateChange) => (c.kind.type === 'delete' ? { before: c.diff, after: '' } : splitDiff(c.diff));

function fileUse(itemId: string, i: number, c: FileUpdateChange, at: number): ChatEvent {
  const { before, after } = changeText(c);
  const id = `${itemId}:${i}`;
  return c.kind.type === 'add' ? toolUseEvent(id, 'Write', { file_path: c.path, content: after }, at) : toolUseEvent(id, 'Edit', { file_path: c.path, old_string: before, new_string: after }, at);
}

const mcpName = (i: { server: string; tool: string }) => `mcp__${i.server}__${i.tool}`;

// The tool steps an item opens; the item's own text and reasoning are not steps.
export function startedEvents(item: ThreadItem, at: number): ChatEvent[] {
  switch (item.type) {
    case 'commandExecution': return [toolUseEvent(item.id, 'Bash', { command: item.command }, at)];
    case 'fileChange': return item.changes.map((c, i) => fileUse(item.id, i, c, at));
    case 'mcpToolCall': return [toolUseEvent(item.id, mcpName(item), item.arguments ?? {}, at)];
    case 'webSearch': return [toolUseEvent(item.id, 'WebSearch', { query: item.query }, at)];
    default: return [];
  }
}

const FAILED = new Set(['failed', 'declined']);

const result = (toolUseId: string, status: string, text: string, at: number, failed = FAILED.has(status)): ChatEvent => ({
  id: `${toolUseId}:result`,
  kind: 'tool_result',
  toolUseId,
  text: status === 'declined' ? DENIED : text.slice(0, MAX_RESULT),
  isError: failed,
  at,
});

const mcpText = (item: Extract<ThreadItem, { type: 'mcpToolCall' }>) =>
  item.error?.message ?? (item.result?.content ?? []).map((c) => (c as { text?: unknown }).text).filter((t): t is string => typeof t === 'string').join('\n');

// The results of a finished item, one per step it opened.
export function finishedEvents(item: ThreadItem, at: number): ChatEvent[] {
  switch (item.type) {
    case 'commandExecution': return [result(item.id, item.status, item.aggregatedOutput ?? '', at, FAILED.has(item.status) || (item.exitCode !== null && item.exitCode !== 0))];
    case 'fileChange': return item.changes.map((_, i) => result(`${item.id}:${i}`, item.status, item.status === 'completed' ? 'Applied' : 'Not applied', at));
    case 'mcpToolCall': return [result(item.id, item.status, mcpText(item), at, FAILED.has(item.status) || Boolean(item.error))];
    case 'webSearch': return [result(item.id, 'completed', '', at)];
    default: return [];
  }
}

const userText = (item: Extract<ThreadItem, { type: 'userMessage' }>) => item.content.map((c) => c.text ?? '').join('\n').trim();

// A thread's turns as a transcript, with the same events a live chat produces.
export function historyEvents(turns: Turn[], fallbackAt: number): ChatEvent[] {
  const events: ChatEvent[] = [];
  for (const turn of turns) {
    const at = turn.startedAt ? turn.startedAt * 1000 : fallbackAt;
    let last = '';
    for (const item of turn.items) {
      if (item.type === 'userMessage') events.push({ id: item.id, kind: 'user', text: userText(item), at });
      else if (item.type === 'agentMessage') {
        last = item.text;
        events.push({ id: item.id, kind: 'assistant', text: item.text, streaming: false, at });
      } else events.push(...startedEvents(item, at), ...finishedEvents(item, at));
    }
    if (turn.status !== 'inProgress') events.push({ id: `${turn.id}:result`, kind: 'result', text: last, costUsd: 0, isError: turn.status === 'failed', at });
  }
  return events;
}
