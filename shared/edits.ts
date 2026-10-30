import type { ChatEvent } from './protocol.js';

export type EditCount = { add: number; del: number };

const MORE = /\n… (\d+) more lines$/;
const lines = (v: unknown) => {
  if (typeof v !== 'string' || !v.length) return 0;
  const m = v.match(MORE);
  return v.split('\n').length - (v.endsWith('\n') ? 1 : 0) + (m ? Number(m[1]) - 1 : 0);
};

export function editCount(name: string, input: Record<string, unknown>): EditCount | null {
  if (name === 'Write') return { add: lines(input.content), del: 0 };
  if (name === 'Edit') return { add: lines(input.new_string), del: lines(input.old_string) };
  if (name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
    return edits.reduce<EditCount>((n, e) => ({ add: n.add + lines(e.new_string), del: n.del + lines(e.old_string) }), { add: 0, del: 0 });
  }
  return null;
}

export function failedTools(events: ChatEvent[]) {
  const failed = new Set<string>();
  for (const e of events) if (e.kind === 'tool_result' && e.isError) failed.add(e.toolUseId);
  return failed;
}

// Tool inputs never change after the event is stored, so count each tool_use once.
const counts = new WeakMap<object, EditCount | null>();
const countOf = (e: { name: string; input: Record<string, unknown> }) => {
  let c = counts.get(e);
  if (c === undefined) counts.set(e, (c = editCount(e.name, e.input)));
  return c;
};

export function sumEdits(events: ChatEvent[]): EditCount | undefined {
  const failed = failedTools(events);
  let total: EditCount | undefined;
  for (const e of events) {
    if (e.kind !== 'tool_use' || failed.has(e.id)) continue;
    const c = countOf(e);
    if (c) total = { add: (total?.add ?? 0) + c.add, del: (total?.del ?? 0) + c.del };
  }
  return total;
}

export function replyLine(events: ChatEvent[], max = 60): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'assistant' || e.parent || !e.text.trim()) continue;
    const line = e.text.trim().split('\n')[0].replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim();
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return undefined;
}
