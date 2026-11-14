import { BIG_BRO, type ChatEvent } from '../../../shared/protocol.js';

// Tool steps in Claude's tool vocabulary, which every provider's events use (Providers rule 1).

export type AgentIds = Map<string, string>;

const CLIP = 4096;

// Tool results kept in events, as the transcript reader and both live drivers store them.
export const clipResult = (text: string) => text.slice(0, 4000);

// The tools that write files, and the file one writes (a notebook edit names notebook_path).
export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
export const editedPath = (input: unknown) => {
  const { file_path, notebook_path } = (input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
  const file = file_path ?? notebook_path;
  return typeof file === 'string' ? file : undefined;
};

// Long strings in tool inputs (whole files in Write and Edit) are cut for the UI; the marker keeps editCount exact.
export function clipInput(v: unknown): unknown {
  if (typeof v === 'string') {
    if (v.length <= CLIP) return v;
    const head = v.slice(0, CLIP);
    const more = v.replace(/\n$/, '').split('\n').length - head.split('\n').length;
    return more > 0 ? `${head}\n… ${more} more lines` : `${head} …`;
  }
  if (Array.isArray(v)) return v.map(clipInput);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clipInput(x)]));
  return v;
}

export function toolUseEvent(id: string, name: string, rawInput: unknown, at: number, parent?: string, agents?: AgentIds): ChatEvent {
  const input = clipInput(rawInput ?? {}) as Record<string, unknown>;
  const agent = name === 'SendMessage' && typeof input.to === 'string' ? agents?.get(input.to) : undefined;
  return { id, kind: 'tool_use', name, input, summary: summarizeTool(name, input), at, ...(parent && { parent }), ...(agent && { agent }) };
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
