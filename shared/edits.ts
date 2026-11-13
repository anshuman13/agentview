import type { ChatEvent, RoundOutcome } from './protocol.js';

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

function failedTools(events: ChatEvent[]) {
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

// A loop round or goal round ends its reply with `ROUND: <done|progress|blocked|question|nothing> <summary>`.
const ROUND_TAIL = /(?:^|\n)[ \t]*ROUND:([^\n]*)\s*$/i;
const ROUND_WORD = /^\s*(done|progress|blocked|question|nothing)\b[:\s-]*(.*)$/i;

export const stripRound = (text: string) => {
  const m = ROUND_TAIL.exec(text);
  return m ? text.slice(0, m.index).trimEnd() : text;
};

export function roundOf(text: string): { outcome: RoundOutcome; line: string } | null {
  const p = ROUND_WORD.exec(ROUND_TAIL.exec(text)?.[1] ?? '');
  if (!p) return null;
  const word = p[1].toLowerCase();
  return { outcome: word === 'nothing' ? 'quiet' : (word as RoundOutcome), line: p[2].trim() };
}

const firstLine = (text: string) => text.split('\n')[0].replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim();
const clip = (line: string, max: number) => (line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line);

export function replyLine(events: ChatEvent[], max = 60): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const text = e.kind === 'assistant' && !e.parent ? stripRound(e.text).trim() : '';
    if (text) return clip(firstLine(text), max);
  }
  return undefined;
}

export const RECAP_MIN = 200;
const RECAP_MAX = 400;

// The one line a finished turn leaves behind: its ROUND summary, else the first sentence of its last reply. A turn without tool use and a short reply leaves none.
function turnRecap(turn: ChatEvent[]): string | undefined {
  const top = turn.filter((e) => !('parent' in e && e.parent));
  const reply = [...top].reverse().find((e) => e.kind === 'assistant' && !e.streaming && stripRound(e.text).trim());
  if (reply?.kind !== 'assistant') return undefined;
  const text = stripRound(reply.text).trim();
  if (text.length <= RECAP_MIN && !top.some((e) => e.kind === 'tool_use')) return undefined;
  const line = roundOf(reply.text)?.line || firstLine(text).split(/(?<=[.!?])\s/)[0];
  return clip(line, RECAP_MAX) || undefined;
}

// The recap of the newest turn that has one; a turn still running is left out.
export function recapOf(events: ChatEvent[], running: boolean): string | undefined {
  let end = events.length;
  let skip = running;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind !== 'user') continue;
    if (!skip) {
      const line = turnRecap(events.slice(i + 1, end));
      if (line) return line;
    }
    skip = false;
    end = i;
  }
  return undefined;
}
