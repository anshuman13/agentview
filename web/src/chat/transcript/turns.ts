import { editCount, stripRound } from '../../../../shared/edits';
import { BIG_BRO, type ChatEvent } from '../../../../shared/protocol';
import { chatCost } from '../../../../shared/cost';
export { chatCost };
import { denied, fastFrom, tailStart, firstLine, str, type ToolResult, type ToolUse } from './steps';

type FileFact = { path: string; add: number; del: number };
type CommandFact = { id: string; label: string; done?: boolean; error?: string; denied?: boolean };
type NoteFact = { id: string; text: string; kind: 'done' | 'important' | 'fable' };

// A failed command stops counting once a later command in the same turn succeeds.
export function openFailures(commands: CommandFact[]) {
  const ok = commands.map((c) => c.done && !c.error && !c.denied).lastIndexOf(true);
  return commands.filter((c, i) => c.error && i > ok);
}

export type Turn = {
  id: string;
  prompt: string;
  phase: boolean;
  reply?: { id: string; text: string; streaming: boolean; at: number };
  files: FileFact[];
  commands: CommandFact[];
  notes: NoteFact[];
};

const PHASE_TEXT: Record<string, string> = { plan: 'Plan · Opus', build: 'Build · Opus', test: 'Test · Sonnet' };
const WOKE_UP = /^\w+ woke up/;

function handBack(text: string) {
  if (!text.startsWith('[Subagent hand-back]')) return text.trim();
  const lines = text.split('\n').slice(1);
  return lines.filter((l) => l.startsWith('  ') || l === '').map((l) => l.slice(2)).join('\n').trim();
}

function errorLine(text: string) {
  return text.split('\n').map((l) => l.trim()).find((l) => l && !/^Exit code \d+$/.test(l)) ?? 'Failed';
}


function newTurn(id: string, prompt: string, phase = false): Turn {
  return { id, prompt, phase, files: [], commands: [], notes: [] };
}

type Snapshot = { turns: Turn[]; next: string[]; advisor: number; lastTool?: ToolUse; fable: number };

const cloneTurn = (t: Turn): Turn => ({ ...t, notes: [...t.notes] });

export const buildTurns = (events: ChatEvent[]) => turnsFrom(events).out;

const isNoteText = (text: string) => ['Compact', 'Loop ', 'Build cycle', 'Goal', 'Usage limit', 'Logged out'].some((p) => text.startsWith(p));

function recordStatus(turn: Turn, e: ToolUse, next: string[]) {
  const done = str(e.input.done).trim();
  const important = str(e.input.important).trim();
  if (done) turn.notes.push({ id: `${e.id}:done`, text: done, kind: 'done' });
  if (important) turn.notes.push({ id: `${e.id}:note`, text: important, kind: 'important' });
  return Array.isArray(e.input.next) ? e.input.next.filter((x): x is string => typeof x === 'string') : next;
}

function recordTool(turn: Turn, e: ToolUse, result: ToolResult | undefined) {
  const count = editCount(e.name, e.input);
  const path = str(e.input.file_path);
  if (count && path && !result?.isError) {
    const f = turn.files.find((x) => x.path === path);
    if (f) { f.add += count.add; f.del += count.del; } else turn.files.push({ path, ...count });
  }
  if (e.name === 'Bash') {
    const cmd = str(e.input.command);
    if (!e.parent) turn.commands.push({ id: e.id, label: str(e.input.description) || firstLine(cmd), done: !!result, ...(denied(result) ? { denied: true } : { error: result?.isError ? errorLine(result.text) : undefined }) });
  }
}

// Builds from events[from] on, resuming from a snapshot taken before `from`. With `split`, also returns a snapshot taken before events[split].
function turnsFrom(events: ChatEvent[], from = 0, split?: number, seed?: Snapshot) {
  const results = new Map<string, ToolResult>();
  for (const e of events.slice(from)) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
  const turns: Turn[] = seed ? seed.turns.map((t, i) => (i === seed.turns.length - 1 ? cloneTurn(t) : t)) : [];
  const turnOf = new Map<string, Turn>();
  const fableCalls = new Set<string>();
  let next = seed?.next ?? [];
  let advisor = seed?.advisor ?? 0;
  let lastTool = seed?.lastTool;
  let snap: Snapshot | undefined;
  const take = () => {
    const last = turns.at(-1);
    snap = { turns: turns.map((t) => (t === last ? cloneTurn(t) : t)), next, advisor, lastTool, fable: fableCalls.size };
  };
  const current = () => turns.at(-1) ?? turns[turns.push(newTurn('start', '')) - 1];

  for (let i = from; i <= events.length; i++) {
    if (i === split) take();
    const e = events[i];
    if (!e) break;
    if (e.kind === 'user') {
      next = [];
      const prompt = e.phase ? (e.text.startsWith('Test') ? `Test ${e.text.slice(5)} · Sonnet` : PHASE_TEXT[e.phase] ?? e.text) : e.text;
      turns.push(newTurn(e.id, prompt, Boolean(e.phase)));
      continue;
    }
    if (e.kind === 'system' && WOKE_UP.test(e.text)) {
      turns.push(newTurn(e.id, e.text, true));
      continue;
    }
    const parent = e.kind === 'tool_use' ? e.parent : e.kind === 'tool_result' ? e.toolUseId : undefined;
    const turn = (parent && turnOf.get(parent)) || current();
    turnOf.set(e.id, turn);
    if (parent && !turnOf.has(parent)) turnOf.set(parent, turn);
    if (e.kind === 'assistant' && !e.parent) {
      const text = stripRound(e.text).trim();
      if (text) turn.reply = { id: e.id, text, streaming: e.streaming, at: e.at };
    }
    if (e.kind === 'plan') next = e.next;
    if (e.kind === 'system' && isNoteText(e.text)) turn.notes.push({ id: e.id, text: e.text, kind: /fail|limit|logged out/i.test(e.text) ? 'important' : 'done' });
    if (e.kind === 'tool_result' && fableCalls.has(e.toolUseId) && !e.isError) turn.notes.push({ id: e.id, text: handBack(e.text), kind: 'fable' });
    if (e.kind !== 'tool_use') continue;
    if (e.name.endsWith('__set_status')) {
      if (!e.parent) next = recordStatus(turn, e, next);
      continue;
    }
    lastTool = e;
    const result = results.get(e.id);
    if (e.name === 'Advisor') advisor++;
    if (e.input.subagent_type === BIG_BRO) fableCalls.add(e.id);
    recordTool(turn, e, result);
  }

  const kept = turns.filter((t) => t.id !== 'start' || t.reply || t.files.length || t.commands.length || t.notes.length);
  return { out: { turns: kept, next, lastTool, advisor, fable: (seed?.fable ?? 0) + fableCalls.size }, snap };
}

export function createTurnsBuilder() {
  let prev: ChatEvent[] = [];
  let out = buildTurns(prev);
  let start = 0;
  let snap: Snapshot | undefined;
  return (events: ChatEvent[]): ReturnType<typeof buildTurns> => {
    const k = fastFrom(prev, start, events);
    if (k < 0 || !snap) {
      start = tailStart(events);
      ({ out, snap } = turnsFrom(events, 0, start));
    } else if (k < events.length) out = turnsFrom(events, start, undefined, snap).out;
    prev = events;
    return out;
  };
}
