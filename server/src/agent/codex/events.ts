import type { ChatEvent } from '../../../../shared/protocol.js';
import { clipResult, toolUseEvent } from '../steps.js';
import { thinkingEvent } from '../claude/transcript.js';
import type { FileUpdateChange, ThreadItem, Turn, TurnPlanStepStatus, TurnPlanUpdatedNotification } from './protocol.js';

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
  text: status === 'declined' ? DENIED : clipResult(text),
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

const TODO_STATUS = { pending: 'pending', inProgress: 'in_progress', completed: 'completed' } as const;

// An update_plan checklist as a TodoWrite step, so the chat's checklist shows it. Each update gets its own id and the checklist takes the latest.
export function planEvents(turnId: string, n: number | string, plan: TurnPlanUpdatedNotification['plan'], at: number): ChatEvent[] {
  const id = `${turnId}:plan:${n}`;
  const todos = plan.map((p) => ({ content: p.step, activeForm: p.step, status: TODO_STATUS[p.status] ?? 'pending' }));
  return [toolUseEvent(id, 'TodoWrite', { todos }, at), result(id, 'completed', 'Plan updated', at)];
}

// A reasoning item as one thinking row: the summary, else what streamed, else the raw text. Empty reasoning gives none.
export function reasoningEvent(item: Extract<ThreadItem, { type: 'reasoning' }>, at: number, streamed = ''): ChatEvent | null {
  return thinkingEvent(item.id, { thinking: item.summary.join('\n') || streamed || item.content.join('\n') }, at);
}

const userText = (item: Extract<ThreadItem, { type: 'userMessage' }>) => item.content.map((c) => c.text ?? '').join('\n').trim();

export type SavedPlan = { turnId: string; plan: TurnPlanUpdatedNotification['plan'] };

const PLAN_STATUS: Record<string, TurnPlanStepStatus> = { pending: 'pending', in_progress: 'inProgress', inProgress: 'inProgress', completed: 'completed' };
const STEP = /\{\s*"?step"?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*"?status"?\s*:\s*["']([a-zA-Z_]+)["']\s*\}/g;

function planSteps(code: string) {
  const at = code.lastIndexOf('update_plan');
  if (at < 0) return null;
  const steps = [...code.slice(at).matchAll(STEP)].map((m) => ({ step: m[1].slice(1, -1).replace(/\\(.)/g, '$1'), status: PLAN_STATUS[m[2]] ?? 'pending' }));
  return steps.length ? steps : null;
}

// The last update_plan checklist in a Codex rollout file. Plans are not thread items, so a reloaded thread only has them here,
// as an update_plan function call or inside the code of an exec tool call.
export function rolloutPlan(rollout: string): SavedPlan | null {
  let last: SavedPlan | null = null;
  for (const line of rollout.split('\n')) {
    if (!line.includes('update_plan') || !line.includes('"response_item"')) continue;
    try {
      const p = JSON.parse(line).payload;
      const code = p.type === 'function_call' && p.name === 'update_plan' ? `update_plan(${p.arguments})` : p.type === 'custom_tool_call' ? p.input : null;
      const plan = typeof code === 'string' ? planSteps(code) : null;
      const turnId = p.internal_chat_message_metadata_passthrough?.turn_id ?? '';
      if (plan) last = { turnId, plan };
    } catch {}
  }
  return last;
}

// A thread's turns as a transcript, with the same events a live chat produces, and the saved checklist at the end of its turn.
export function historyEvents(turns: Turn[], fallbackAt: number, saved: SavedPlan | null = null): ChatEvent[] {
  const events: ChatEvent[] = [];
  for (const turn of turns) {
    const at = turn.startedAt ? turn.startedAt * 1000 : fallbackAt;
    let last = '';
    for (const item of turn.items) {
      if (item.type === 'userMessage') events.push({ id: item.id, kind: 'user', text: userText(item), at });
      else if (item.type === 'agentMessage') {
        last = item.text;
        events.push({ id: item.id, kind: 'assistant', text: item.text, streaming: false, at });
      } else if (item.type === 'reasoning') {
        const ev = reasoningEvent(item, at);
        if (ev) events.push(ev);
      } else events.push(...startedEvents(item, at), ...finishedEvents(item, at));
    }
    if (saved && (saved.turnId === turn.id || (turn === turns.at(-1) && !turns.some((t) => t.id === saved.turnId)))) events.push(...planEvents(turn.id, 'saved', saved.plan, at));
    if (turn.status !== 'inProgress') events.push({ id: `${turn.id}:result`, kind: 'result', text: last, isError: turn.status === 'failed', at });
  }
  return events;
}
