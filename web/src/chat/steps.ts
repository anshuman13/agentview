import { editCount, type EditCount } from '../../../shared/edits';
import type { ChatEvent } from '../../../shared/protocol';

export type ToolUse = Extract<ChatEvent, { kind: 'tool_use' }>;
export type ToolResult = Extract<ChatEvent, { kind: 'tool_result' }>;

export type Item =
  | { kind: 'user'; id: string; text: string; at: number; stopping?: boolean; queued?: boolean }
  | { kind: 'phase'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'step'; id: string; use: ToolUse; result?: ToolResult }
  | { kind: 'file'; id: string; path: string; count: EditCount; uses: ToolUse[]; error?: string; denied?: boolean }
  | { kind: 'agent'; id: string; use: ToolUse; result?: ToolResult; running: boolean; steps: Item[] }
  | { kind: 'blocked'; id: string; ev: Extract<ChatEvent, { kind: 'blocked' }> };

export type Label = { verb: string; object: string; mono?: boolean; cmd?: string };

const AGENT_TOOLS = new Set(['Agent', 'Task']);

export const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';

const DENIED = /^(The user doesn't want to proceed|User denied this action|aborted\b|Session closed|The user sent a new message instead|Claude exited before this was answered)/;
export const denied = (result?: ToolResult) => Boolean(result?.isError && DENIED.test(result.text.trim()));

export function relPath(p: string, cwd: string) {
  if (!cwd) return p;
  if (p === cwd) return '.';
  return p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p;
}

export function duration(ms: number) {
  if (!(ms >= 1000)) return '';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function stepLabel(name: string, input: Record<string, unknown>, cwd = ''): Label {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const rel = (k: string) => relPath(s(k), cwd);
  const inDir = s('path') && rel('path') !== '.' ? rel('path') : '';
  switch (name) {
    case 'Read': return { verb: 'Read', object: rel('file_path') };
    case 'Edit': case 'MultiEdit': return { verb: 'Edited', object: rel('file_path') };
    case 'NotebookEdit': return { verb: 'Edited', object: rel('notebook_path') };
    case 'Write': return { verb: 'Wrote', object: rel('file_path') };
    case 'Grep': return { verb: 'Searched', object: `"${s('pattern')}" in ${inDir || 'the project'}` };
    case 'Glob': return { verb: 'Listed', object: inDir ? `${inDir}/${s('pattern')}` : s('pattern') };
    case 'LS': return { verb: 'Listed', object: `${inDir || '.'}/` };
    case 'Bash': return s('description') ? { verb: '', object: s('description'), cmd: s('command') } : { verb: 'Ran', object: firstLine(s('command')), mono: true };
    case 'WebFetch': return { verb: 'Fetched', object: s('url').replace(/^https?:\/\//, '').replace(/\/$/, '') };
    case 'WebSearch': return { verb: 'Searched the web for', object: `"${s('query')}"` };
    case 'Agent': case 'Task': return { verb: 'Delegated', object: s('description') };
    case 'SendMessage': return { verb: 'Messaged agent', object: s('summary') || s('to') };
    case 'TodoWrite': return { verb: 'Updated', object: 'the to-do list' };
    case 'AskUserQuestion': return { verb: 'Asked', object: 'you a question' };
    case 'Skill': return { verb: 'Loaded', object: `the ${s('skill')} skill` };
    case 'ToolSearch': return { verb: 'Looked up', object: `tools for "${s('query')}"` };
    case 'Advisor': return { verb: 'Consulted', object: 'the advisor' };
    case 'ExitPlanMode': return { verb: 'Proposed', object: 'a plan' };
    case 'EnterPlanMode': return { verb: 'Entered', object: 'plan mode' };
  }
  if (name.startsWith('mcp__')) {
    const [, server, ...tool] = name.split('__');
    return { verb: 'Called', object: `${tool.join('__')} (${server})` };
  }
  return { verb: 'Used', object: name };
}

export type Tone = 'read' | 'edit' | 'run' | 'web' | 'mcp' | 'agent' | 'other';

const TONES: Record<string, Tone> = {
  Read: 'read', Grep: 'read', Glob: 'read', LS: 'read', ToolSearch: 'read',
  Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  Bash: 'run', WebFetch: 'web', WebSearch: 'web', SendMessage: 'agent',
};

export const stepTone = (name: string): Tone => TONES[name] ?? (name.startsWith('mcp__') ? 'mcp' : 'other');

export function buildTranscript(events: ChatEvent[]): Item[] {
  const results = new Map<string, ToolResult>();
  const children = new Map<string, ChatEvent[]>();
  const resumed = new Map<string, number>();
  for (const e of events) {
    if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    if (e.kind === 'tool_use' && e.agent) resumed.set(e.agent, e.at);
    const parent = (e.kind === 'tool_use' || e.kind === 'tool_result' || e.kind === 'assistant') && e.parent;
    if (parent) {
      const list = children.get(parent);
      if (list) list.push(e);
      else children.set(parent, [e]);
    }
  }
  return itemsFrom(events.filter((e) => !('parent' in e && e.parent)), results, children, resumed);
}

function itemsFrom(events: ChatEvent[], results: Map<string, ToolResult>, children: Map<string, ChatEvent[]>, resumed: Map<string, number>): Item[] {
  const items: Item[] = [];
  for (const e of events) {
    if (e.kind === 'user') items.push(e.phase ? { kind: 'phase', id: e.id, text: e.text } : { kind: 'user', id: e.id, text: e.text, at: e.at, stopping: e.stopping, queued: e.queued });
    else if (e.kind === 'assistant') { if (e.text.trim()) items.push({ kind: 'assistant', id: e.id, text: e.text, streaming: e.streaming }); }
    else if (e.kind === 'system') items.push({ kind: 'system', id: e.id, text: e.text });
    else if (e.kind === 'blocked') items.push({ kind: 'blocked', id: e.id, ev: e });
    else if (e.kind === 'plan') items.push({ kind: 'system', id: e.id, text: e.next.length ? `You changed the next steps (${e.next.length})` : 'You cleared the next steps' });
    else if (e.kind === 'tool_use' && !e.name.endsWith('__set_status')) {
      const result = results.get(e.id);
      const count = editCount(e.name, e.input);
      const path = typeof e.input.file_path === 'string' ? e.input.file_path : '';
      if (AGENT_TOOLS.has(e.name)) items.push({ kind: 'agent', id: e.id, use: e, result, running: !result || (resumed.get(e.id) ?? 0) > result.at, steps: itemsFrom(children.get(e.id) ?? [], results, children, resumed) });
      else if (!count || !path) items.push({ kind: 'step', id: e.id, use: e, result });
      else {
        const error = result?.isError ? (denied(result) ? 'Denied' : firstLine(result.text)) : undefined;
        const prev = items[items.length - 1];
        if (!error && prev?.kind === 'file' && prev.path === path && !prev.error) {
          prev.uses.push(e);
          prev.count = { add: prev.count.add + count.add, del: prev.count.del + count.del };
        } else items.push({ kind: 'file', id: e.id, path, count: error ? { add: 0, del: 0 } : count, uses: [e], error, ...(denied(result) && { denied: true }) });
      }
    }
  }
  return items;
}
