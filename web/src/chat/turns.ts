import { editCount, stripRound } from '../../../shared/edits';
import { BIG_BRO, type ChatEvent } from '../../../shared/protocol';
import { chatCost } from '../../../shared/cost';
export { chatCost };
import { buildTranscript, denied, fastFrom, tailStart, firstLine, str, type Item, type ToolResult, type ToolUse } from './steps';

type FileFact = { path: string; add: number; del: number };
type CommandFact = { id: string; label: string; done?: boolean; error?: string; denied?: boolean };
type CommitFact = { hash: string; subject: string };
type AgentFact = { id: string; label: string; type: string; state: 'running' | 'done' | 'failed' | 'stopped' | 'denied' };
type NoteFact = { id: string; text: string; kind: 'done' | 'important' | 'fable' };
export type Blocked = Extract<ChatEvent, { kind: 'blocked' }>;

// A failed command stops counting once a later command in the same turn succeeds.
export function openFailures(commands: CommandFact[]) {
  const ok = commands.map((c) => c.done && !c.error && !c.denied).lastIndexOf(true);
  return commands.filter((c, i) => c.error && i > ok);
}

export type Turn = {
  id: string;
  prompt: string;
  phase: boolean;
  at: number;
  stopping?: boolean;
  queued?: boolean;
  reply?: { id: string; text: string; streaming: boolean; at: number };
  ended?: number;
  files: FileFact[];
  commands: CommandFact[];
  commits: CommitFact[];
  agents: AgentFact[];
  notes: NoteFact[];
  blocked: Blocked[];
  steps: Item[];
};

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const PHASE_TEXT: Record<string, string> = { plan: 'Plan · Opus', build: 'Build · Opus', test: 'Test · Sonnet' };
const COMMIT = /^\[([^\]\n]+) ([0-9a-f]{7,40})\] (.+)$/gm;

function handBack(text: string) {
  if (!text.startsWith('[Subagent hand-back]')) return text.trim();
  const lines = text.split('\n').slice(1);
  return lines.filter((l) => l.startsWith('  ') || l === '').map((l) => l.slice(2)).join('\n').trim();
}

function errorLine(text: string) {
  return text.split('\n').map((l) => l.trim()).find((l) => l && !/^Exit code \d+$/.test(l)) ?? 'Failed';
}


function newTurn(id: string, prompt: string, at: number, phase = false): Turn {
  return { id, prompt, phase, at, files: [], commands: [], commits: [], agents: [], notes: [], blocked: [], steps: [] };
}

type Snapshot = { turns: Turn[]; next: string[]; advisor: number; lastTool?: ToolUse; fable: number; lastItems: Item[] };

const cloneTurn = (t: Turn): Turn => ({ ...t, notes: [...t.notes], blocked: [...t.blocked], steps: [...t.steps] });

export const buildTurns = (events: ChatEvent[]) => turnsFrom(events).out;

// Builds from events[from] on, resuming from a snapshot taken before `from`. With `split`, also returns a snapshot taken before events[split].
function turnsFrom(events: ChatEvent[], from = 0, split?: number, seed?: Snapshot) {
  const results = new Map<string, ToolResult>();
  const resumed = new Map<string, number>();
  for (const e of events.slice(from)) {
    if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    if (e.kind === 'tool_use' && e.agent) resumed.set(e.agent, e.at);
  }
  const turns: Turn[] = seed ? seed.turns.map((t, i) => (i === seed.turns.length - 1 ? cloneTurn(t) : t)) : [];
  const seeded = seed && turns.at(-1);
  const turnOf = new Map<string, Turn>();
  const fableCalls = new Set<string>();
  let next = seed?.next ?? [];
  let advisor = seed?.advisor ?? 0;
  let lastTool = seed?.lastTool;
  let snap: Snapshot | undefined;
  let splitLast: Turn | undefined;
  const take = () => {
    splitLast = turns.at(-1);
    snap = { turns: turns.map((t) => (t === splitLast ? cloneTurn(t) : t)), next, advisor, lastTool, fable: fableCalls.size, lastItems: [] };
  };
  const current = () => turns.at(-1) ?? turns[turns.push(newTurn('start', '', events[0]?.at ?? 0)) - 1];

  for (let i = from; i <= events.length; i++) {
    if (i === split) take();
    const e = events[i];
    if (!e) break;
    if (e.kind === 'user') {
      next = [];
      const prompt = e.phase ? (e.text.startsWith('Test') ? `Test ${e.text.slice(5)} · Sonnet` : PHASE_TEXT[e.phase] ?? e.text) : e.text;
      turns.push({ ...newTurn(e.id, prompt, e.at, Boolean(e.phase)), stopping: e.stopping, queued: e.queued });
      continue;
    }
    if (e.kind === 'system' && e.text.startsWith('Claude woke up')) {
      turns.push(newTurn(e.id, e.text, e.at, true));
      continue;
    }
    const parent = e.kind === 'tool_use' ? e.parent : e.kind === 'tool_result' ? e.toolUseId : undefined;
    const turn = (parent && turnOf.get(parent)) || current();
    turnOf.set(e.id, turn);
    if (e.kind === 'assistant' && !e.parent) {
      const text = stripRound(e.text).trim();
      if (text) turn.reply = { id: e.id, text, streaming: e.streaming, at: e.at };
    }
    if (e.kind === 'plan') next = e.next;
    if (e.kind === 'blocked') turn.blocked.push(e);
    if (e.kind === 'result') turn.ended = e.at;
    if (e.kind === 'system' && (e.text.startsWith('Compact') || e.text.startsWith('Loop ') || e.text.startsWith('Build cycle') || e.text.startsWith('Goal') || e.text.startsWith('Usage limit') || e.text.startsWith('Logged out'))) {
      turn.notes.push({ id: e.id, text: e.text, kind: /fail|limit|logged out/i.test(e.text) ? 'important' : 'done' });
    }
    if (e.kind === 'tool_result' && fableCalls.has(e.toolUseId) && !e.isError) turn.notes.push({ id: e.id, text: handBack(e.text), kind: 'fable' });
    if (e.kind !== 'tool_use') continue;
    if (e.name.endsWith('__set_status')) {
      if (e.parent) continue;
      const done = str(e.input.done).trim();
      const important = str(e.input.important).trim();
      if (done) turn.notes.push({ id: `${e.id}:done`, text: done, kind: 'done' });
      if (important) turn.notes.push({ id: `${e.id}:note`, text: important, kind: 'important' });
      if (Array.isArray(e.input.next)) next = e.input.next.filter((x): x is string => typeof x === 'string');
      continue;
    }
    lastTool = e;
    const result = results.get(e.id);
    if (e.name === 'Advisor') advisor++;
    if (e.input.subagent_type === BIG_BRO) fableCalls.add(e.id);
    const count = editCount(e.name, e.input);
    const path = str(e.input.file_path);
    if (count && path && !result?.isError) {
      const f = turn.files.find((x) => x.path === path);
      if (f) { f.add += count.add; f.del += count.del; } else turn.files.push({ path, ...count });
    }
    if (e.name === 'Bash') {
      const cmd = str(e.input.command);
      if (!e.parent) turn.commands.push({ id: e.id, label: str(e.input.description) || firstLine(cmd), done: !!result, ...(denied(result) ? { denied: true } : { error: result?.isError ? errorLine(result.text) : undefined }) });
      if (result && !result.isError && /\bgit\b[\s\S]*\bcommit\b/.test(cmd)) {
        for (const m of result.text.matchAll(COMMIT)) if (!turn.commits.some((c) => c.hash === m[2])) turn.commits.push({ hash: m[2], subject: m[3].trim() });
      }
    }
    if (AGENT_TOOLS.has(e.name) && !e.parent) {
      const running = !result || (resumed.get(e.id) ?? 0) > result.at;
      const state = running ? 'running' : result.stopped ? 'stopped' : denied(result) ? 'denied' : result.isError ? 'failed' : 'done';
      turn.agents.push({ id: e.id, label: str(e.input.description) || 'Sub-agent', type: str(e.input.subagent_type), state });
    }
  }

  const starts = new Set(turns.map((t) => t.id));
  if (seed && seeded) seeded.steps = seed.lastItems.filter((it) => it.id !== seeded.reply?.id);
  const tailIds = new Set(split === undefined ? [] : events.slice(split).map((e) => e.id));
  for (const it of buildTranscript(events.slice(from))) {
    const turn = turnOf.get(it.id);
    if (turn && !starts.has(it.id) && it.id !== turn.reply?.id) turn.steps.push(it);
    if (snap && turn && turn === splitLast && !starts.has(it.id) && !tailIds.has(it.id)) snap.lastItems.push(it);
  }
  const kept = turns.filter((t) => t.id !== 'start' || t.reply || t.steps.some((s) => s.kind !== 'system'));
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
