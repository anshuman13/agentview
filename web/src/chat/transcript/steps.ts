import { editCount, stripRound, type EditCount } from '../../../../shared/edits';
import { isSpecPath, specSlug } from '../../../../shared/specTasks';
import { buildStageOf } from '../../../../shared/builds';
import type { ChatEvent } from '../../../../shared/protocol';

export type ToolUse = Extract<ChatEvent, { kind: 'tool_use' }>;
export type ToolResult = Extract<ChatEvent, { kind: 'tool_result' }>;

export type Item =
  | { kind: 'user'; id: string; text: string; at: number; stopping?: boolean; queued?: boolean }
  | { kind: 'phase'; id: string; text: string }
  | { kind: 'auto'; id: string; label: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'system'; id: string; text: string; error?: boolean }
  | { kind: 'step'; id: string; use: ToolUse; result?: ToolResult }
  | { kind: 'file'; id: string; path: string; count: EditCount; uses: ToolUse[]; error?: string; denied?: boolean }
  | { kind: 'agent'; id: string; use: ToolUse; result?: ToolResult; running: boolean; progress: string | null; steps: Item[] }
  | { kind: 'blocked'; id: string; ev: Extract<ChatEvent, { kind: 'blocked' }> }
  | { kind: 'review'; id: string; ev: Extract<ChatEvent, { kind: 'review' }> };

type Label = { verb: string; object: string; mono?: boolean; cmd?: string };

const AGENT_TOOLS = new Set(['Agent', 'Task']);

export const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';
export const str = (v: unknown) => (typeof v === 'string' ? v : '');

const DENIED = /^(The user doesn't want to proceed|User denied this action|aborted\b|Session closed|The user sent a new message instead|\w+ exited before this was answered)/;
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

type Tone = 'read' | 'edit' | 'run' | 'web' | 'mcp' | 'agent' | 'other';

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
  const progress = new Map<string, string>();
  for (const e of events) {
    if (e.kind === 'agent') progress.set(e.toolUseId, e.progress ?? '');
    if (e.kind === 'tool_result') results.set(e.toolUseId, e);
    if (e.kind === 'tool_use' && e.agent) resumed.set(e.agent, e.at);
    const parent = (e.kind === 'tool_use' || e.kind === 'tool_result' || e.kind === 'assistant') && e.parent;
    if (parent) {
      const list = children.get(parent);
      if (list) list.push(e);
      else children.set(parent, [e]);
    }
  }
  const top = events.filter((e) => !('parent' in e && e.parent));
  const ids = new Set(events.map((e) => e.id));
  for (const [id, list] of children) {
    if (ids.has(id)) continue;
    const at = top.findIndex((e) => e.at > list[0].at);
    top.splice(at < 0 ? top.length : at, 0, orphanAgent(id, list[0].at));
  }
  return itemsFrom(top, results, children, resumed, progress);
}

// Steps of a sub-agent whose Agent call is on an earlier page get a stand-in for that call.
function orphanAgent(id: string, at: number): ToolUse {
  return { kind: 'tool_use', id, at, name: 'Agent', input: { description: 'Sub-agent started earlier' }, summary: '' };
}

function itemsFrom(events: ChatEvent[], results: Map<string, ToolResult>, children: Map<string, ChatEvent[]>, resumed: Map<string, number>, progress: Map<string, string>): Item[] {
  const items: Item[] = [];
  for (const e of events) {
    if (e.kind === 'user' && e.auto) items.push({ kind: 'auto', id: e.id, label: e.auto === 'goal' ? `Goal check ${e.round}` : `Loop round ${e.round} · ${firstLine(e.text)}`, text: e.text });
    else if (e.kind === 'user') items.push(e.phase ? { kind: 'phase', id: e.id, text: e.text } : { kind: 'user', id: e.id, text: e.text, at: e.at, stopping: e.stopping, queued: e.queued });
    else if (e.kind === 'assistant') { const text = stripRound(e.text); if (text.trim()) items.push({ kind: 'assistant', id: e.id, text, streaming: e.streaming }); }
    else if (e.kind === 'system') items.push({ kind: 'system', id: e.id, text: e.text, ...(e.error && { error: true }) });
    else if (e.kind === 'blocked') items.push({ kind: 'blocked', id: e.id, ev: e });
    else if (e.kind === 'review') items.push({ kind: 'review', id: e.id, ev: e });
    else if (e.kind === 'plan') items.push({ kind: 'system', id: e.id, text: e.next.length ? `You changed the next steps (${e.next.length})` : 'You cleared the next steps' });
    else if (e.kind === 'tool_use' && !e.name.endsWith('__set_status')) {
      const result = results.get(e.id);
      const count = editCount(e.name, e.input);
      const path = typeof e.input.file_path === 'string' ? e.input.file_path : '';
      if (AGENT_TOOLS.has(e.name)) items.push({ kind: 'agent', id: e.id, use: e, result, running: !result || (resumed.get(e.id) ?? 0) > result.at, progress: progress.get(e.id) || null, steps: itemsFrom(children.get(e.id) ?? [], results, children, resumed, progress) });
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

const TEXT_KINDS = new Set(['assistant', 'user', 'system', 'plan', 'blocked', 'review']);
const textOnly = (e: ChatEvent) => TEXT_KINDS.has(e.kind) && !('parent' in e && e.parent);

// Where the trailing run of top-level text events starts.
export function tailStart(events: ChatEvent[]) {
  let i = events.length;
  while (i > 0 && textOnly(events[i - 1])) i--;
  return i;
}

// The index from which only a text-only tail changed, or -1 when the whole list must be rebuilt.
export function fastFrom(prev: ChatEvent[], prevStart: number, events: ChatEvent[]) {
  if (events.length < prev.length) return -1;
  let k = 0;
  while (k < prev.length && prev[k] === events[k]) k++;
  if (k === events.length) return k;
  return k > 0 && k >= prevStart && tailStart(events) <= k ? k : -1;
}

export function createTranscriptBuilder() {
  let prev: ChatEvent[] = [];
  let items: Item[] = [];
  let start = 0;
  return (events: ChatEvent[]): Item[] => {
    const k = fastFrom(prev, start, events);
    if (k < 0) items = buildTranscript(events);
    else if (k < events.length) {
      const old = new Set(prev.slice(k).map((e) => e.id));
      let n = items.length;
      while (n > 0 && old.has(items[n - 1].id)) n--;
      items = [...items.slice(0, n), ...buildTranscript(events.slice(k))];
    }
    if (k !== events.length) start = tailStart(events);
    prev = events;
    return items;
  };
}

const EXPLORE = new Set(['Read', 'Grep', 'Glob']);
export type StepItem = Extract<Item, { kind: 'step' }>;

// Runs of at least min finished Read, Grep and Glob steps in a row, keyed by the first step's id, so the
// transcript folds each into one Explored row like Slack's compact message groups (the phone does the same).
// Slack-style New line: the first reply or step that arrived after the chat was last seen and before it was opened; android Steps.kt newMarker says the same.
// Slack-style day dividers: the label above each prompt that starts a new day. A chat that stays within today gets none.
export function dayDividers(items: Item[], now: number) {
  const key = (t: number) => new Date(t).toDateString();
  const today = key(now);
  const yesterday = key(now - 864e5);
  const out = new Map<string, string>();
  let prev = '';
  for (const it of items) {
    if (it.kind !== 'user' || it.at <= 0) continue;
    const day = key(it.at);
    if (day !== prev && (prev || day !== today)) {
      const d = new Date(it.at);
      out.set(it.id, day === today ? 'Today' : day === yesterday ? 'Yesterday' : d.toLocaleDateString('en-GB', d.getFullYear() === new Date(now).getFullYear() ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }));
    }
    prev = day;
  }
  return out;
}

export const agentBuild = (use: ToolUse) => buildStageOf(str(use.input.subagent_type), str(use.input.description), str(use.input.prompt));

export const itemSpecSlug = (it: Item) => (it.kind === 'file' ? (!it.error && isSpecPath(it.path) ? specSlug(it.path) : undefined) : it.kind === 'agent' ? agentBuild(it.use)?.slug : undefined);

// The item that holds each spec's live card: the latest successful spec write or build agent naming that slug. Android Steps.kt specCardIds says the same.
export function specCards(items: Item[]) {
  const latest = new Map<string, string>();
  for (const it of items) {
    const slug = itemSpecSlug(it);
    if (slug) latest.set(slug, it.id);
  }
  return new Set(latest.values());
}

// Per slug, the build agents naming it plus those still running, so a card reloads when one starts or ends.
export function specBumps(items: Item[]) {
  const bumps = new Map<string, number>();
  for (const it of items) {
    if (it.kind !== 'agent') continue;
    const slug = agentBuild(it.use)?.slug;
    if (slug) bumps.set(slug, (bumps.get(slug) ?? 0) + 1 + (it.running ? 1 : 0));
  }
  return bumps;
}

// Replies that arrived after the reader scrolled up, for the Jump to latest button.
export const newReplies = (items: Item[], lastSeenId: string) => items.slice(items.findIndex((it) => it.id === lastSeenId) + 1 || items.length).filter((it) => it.kind === 'assistant' && !it.streaming).length;

export function newMarker(items: Item[], ats: Map<string, number>, seen: number, openedAt: number) {
  if (seen <= 0) return null;
  return items.find((it) => it.kind !== 'user' && (ats.get(it.id) ?? 0) > seen && (ats.get(it.id) ?? 0) <= openedAt)?.id ?? null;
}

export function exploreRuns(items: Item[], min = 3) {
  const runs = new Map<string, StepItem[]>();
  let run: StepItem[] = [];
  const close = () => { if (run.length >= min) runs.set(run[0].id, run); run = []; };
  for (const it of items) {
    if (it.kind === 'step' && EXPLORE.has(it.use.name) && it.result && !it.result.isError) run.push(it);
    else close();
  }
  close();
  return runs;
}

export function exploreLabel(steps: StepItem[]) {
  const reads = steps.filter((s) => s.use.name === 'Read').length;
  const searches = steps.length - reads;
  return [reads && `${reads} ${reads === 1 ? 'file' : 'files'}`, searches && `${searches} ${searches === 1 ? 'search' : 'searches'}`].filter(Boolean).join(', ');
}
