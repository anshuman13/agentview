import { editCount } from '../../../shared/edits';
import type { ChatEvent } from '../../../shared/protocol';
import { chatCost } from '../../../shared/cost';
export { chatCost };
import { buildTranscript, denied, firstLine, type Item, type ToolResult, type ToolUse } from './steps';

export type FileFact = { path: string; add: number; del: number };
export type CommandFact = { id: string; label: string; done?: boolean; error?: string; denied?: boolean };
export type CommitFact = { hash: string; subject: string };
export type AgentFact = { id: string; label: string; type: string; state: 'running' | 'done' | 'failed' | 'stopped' | 'denied' };
export type NoteFact = { id: string; text: string; kind: 'done' | 'important' | 'fable' };
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

export const BIG_BRO = 'big-bro';
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const PHASE_TEXT: Record<string, string> = { plan: 'Plan · Opus', build: 'Build · Opus', test: 'Test · Sonnet' };
const COMMIT = /^\[([^\]\n]+) ([0-9a-f]{7,40})\] (.+)$/gm;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function handBack(text: string) {
  if (!text.startsWith('[Subagent hand-back]')) return text.trim();
  const lines = text.split('\n').slice(1);
  return lines.filter((l) => l.startsWith('  ') || l === '').map((l) => l.slice(2)).join('\n').trim();
}

export function errorLine(text: string) {
  return text.split('\n').map((l) => l.trim()).find((l) => l && !/^Exit code \d+$/.test(l)) ?? 'Failed';
}


function newTurn(id: string, prompt: string, at: number, phase = false): Turn {
  return { id, prompt, phase, at, files: [], commands: [], commits: [], agents: [], notes: [], blocked: [], steps: [] };
}

export function buildTurns(events: ChatEvent[]) {
  const results = new Map<string, ToolResult>();
  const resumed = new Map<string, number>();
  for (const e of events) {
    if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    if (e.kind === 'tool_use' && e.agent) resumed.set(e.agent, e.at);
  }
  const turns: Turn[] = [];
  const turnOf = new Map<string, Turn>();
  const fableCalls = new Set<string>();
  let next: string[] = [];
  let advisor = 0;
  let lastTool: ToolUse | undefined;
  const current = () => turns.at(-1) ?? turns[turns.push(newTurn('start', '', events[0]?.at ?? 0)) - 1];

  for (const e of events) {
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
    if (e.kind === 'assistant' && !e.parent && e.text.trim()) turn.reply = { id: e.id, text: e.text.trim(), streaming: e.streaming, at: e.at };
    if (e.kind === 'plan') next = e.next;
    if (e.kind === 'blocked') turn.blocked.push(e);
    if (e.kind === 'result') turn.ended = e.at;
    if (e.kind === 'system' && (e.text.startsWith('Compact') || e.text.startsWith('Loop ') || e.text.startsWith('Usage limit'))) {
      turn.notes.push({ id: e.id, text: e.text, kind: /fail|limit/i.test(e.text) ? 'important' : 'done' });
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
        for (const m of result.text.matchAll(COMMIT)) turn.commits.push({ hash: m[2], subject: m[3].trim() });
      }
    }
    if (AGENT_TOOLS.has(e.name) && !e.parent) {
      const running = !result || (resumed.get(e.id) ?? 0) > result.at;
      const state = running ? 'running' : result.stopped ? 'stopped' : denied(result) ? 'denied' : result.isError ? 'failed' : 'done';
      turn.agents.push({ id: e.id, label: str(e.input.description) || 'Sub-agent', type: str(e.input.subagent_type), state });
    }
  }

  const starts = new Set(turns.map((t) => t.id));
  for (const it of buildTranscript(events)) {
    const turn = turnOf.get(it.id);
    if (turn && !starts.has(it.id) && it.id !== turn.reply?.id) turn.steps.push(it);
  }
  const kept = turns.filter((t) => t.id !== 'start' || t.reply || t.steps.some((s) => s.kind !== 'system'));
  return { turns: kept, next, lastTool, advisor, fable: fableCalls.size };
}
