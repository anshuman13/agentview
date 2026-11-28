import { editCount, stripRound, type EditCount } from '../../../../shared/edits';
import { exploreLabelOf, exploreRunsOf } from '../../../../shared/explore';
import type { ChatEvent } from '../../../../shared/protocol';
import { firstLine } from '../../ui/util';

export type ToolUse = Extract<ChatEvent, { kind: 'tool_use' }>;
export type ToolResult = Extract<ChatEvent, { kind: 'tool_result' }>;

// A file Claude keeps memory in for a folder: <account>/projects/<slug>/memory/<name>.md. Android WorkFold.kt MEMORY_FILE says the same.
export const MEMORY_FILE = /\/projects\/[^/]+\/memory\/[^/]+\.md$/;

export type Item =
  | { kind: 'user'; id: string; text: string; at: number; stopping?: boolean; queued?: boolean; voice?: boolean }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'system'; id: string; text: string; error?: boolean; from?: string }
  | { kind: 'step'; id: string; use: ToolUse; result?: ToolResult }
  | { kind: 'file'; id: string; path: string; count: EditCount; uses: ToolUse[]; error?: string; denied?: boolean; pending?: boolean }
  | { kind: 'agent'; id: string; use: ToolUse; result?: ToolResult; running: boolean; progress: string | null; steps: Item[] }
  | { kind: 'blocked'; id: string; ev: Extract<ChatEvent, { kind: 'blocked' }> }
  | { kind: 'review'; id: string; ev: Extract<ChatEvent, { kind: 'review' }> };

type Label = { verb: string; object: string; mono?: boolean; cmd?: string; url?: string; note?: string };

const AGENT_TOOLS = new Set(['Agent', 'Task']);

export { firstLine };
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

const PUSH = /(?:^|[;&|(\n])\s*git\s+push\b([^;&|\n]*)/;
const PR_CREATE = /(?:^|[;&|(\n])\s*gh\s+pr\s+create\b/;
const PR_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/;

// A Bash call that pushes a branch or opens a PR, named by what it did: "Pushed main", "Created PR #6". Android Steps.kt shipStep says the same.
export function shipStep(command: string, result?: { text: string; isError: boolean }): Omit<Label, 'cmd'> | null {
  if (result?.isError) return null;
  if (PR_CREATE.test(command)) {
    const m = result && PR_URL.exec(result.text);
    return m ? { verb: 'Created', object: `PR #${m[1]}`, url: m[0] } : { verb: 'Created', object: 'a PR' };
  }
  const push = PUSH.exec(command);
  if (!push) return null;
  const ref = push[1].trim().split(/\s+/).filter((a) => a && !a.startsWith('-'))[1] ?? '';
  const branch = ref.slice(ref.lastIndexOf(':') + 1).replace(/^refs\/heads\//, '');
  return { verb: 'Pushed', object: branch && branch !== 'HEAD' ? branch : 'the branch' };
}

// A proposed plan by its first line, with Approved or Not approved once answered. Android Steps.kt planStep says the same.
export function planStep(plan: string, result?: { isError: boolean }): Omit<Label, 'cmd'> {
  const title = plan.split('\n').map((l) => l.replace(/^\s*#+\s*/, '').replace(/\*\*/g, '').trim()).find(Boolean) ?? '';
  const note = result ? (result.isError ? 'Not approved' : 'Approved') : undefined;
  return title ? { verb: 'Proposed plan', object: `\u201c${title}\u201d`, note } : { verb: 'Proposed', object: 'a plan', note };
}

export function stepLabel(name: string, input: Record<string, unknown>, cwd = '', result?: { text: string; isError: boolean }): Label {
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
    case 'Bash': { const ship = shipStep(s('command'), result); if (ship) return { ...ship, cmd: s('command') };
      return s('description') ? { verb: '', object: s('description'), cmd: s('command') } : { verb: 'Ran', object: firstLine(s('command')), mono: true }; }
    case 'WebFetch': return { verb: 'Fetched', object: s('url').replace(/^https?:\/\//, '').replace(/\/$/, '') };
    case 'WebSearch': return { verb: 'Searched the web for', object: `"${s('query')}"` };
    case 'Agent': case 'Task': return { verb: 'Delegated', object: s('description') };
    case 'SendMessage': return { verb: 'Messaged agent', object: s('summary') || s('to') };
    case 'TodoWrite': return { verb: 'Updated', object: 'the to-do list' };
    case 'AskUserQuestion': return { verb: 'Asked', object: 'you a question' };
    case 'Skill': return { verb: 'Loaded', object: `the ${s('skill')} skill` };
    case 'ToolSearch': return { verb: 'Looked up', object: `tools for "${s('query')}"` };
    case ALARM_TOOL: return { verb: 'Set', object: 'an alarm' };
    case BUILD_TOOL: return { verb: 'Started', object: 'a build' };
    case 'Advisor': return { verb: 'Consulted', object: 'the advisor' };
    case 'ExitPlanMode': return planStep(s('plan'), result);
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

export const ALARM_TOOL = 'mcp__agentview__phone_alarm';
export const BUILD_TOOL = 'mcp__agentview__start_build';

export type AlarmCard = { time: string; label: string; status: string; tone: 'pending' | 'ok' | 'error' };

// What the alarm card shows for a phone_alarm call. Android Steps.kt alarmCard says the same.
export function alarmCard(use: ToolUse, result: ToolResult | undefined, running: boolean): AlarmCard {
  const card = { time: str(use.input.time), label: str(use.input.label).trim() };
  if (!result) return running ? { ...card, status: 'Setting on the phone', tone: 'pending' } : { ...card, status: 'Not set', tone: 'error' };
  if (result.text.startsWith('Set on the phone')) {
    const weekday = /^Set on the phone for (\w+);/.exec(result.text)?.[1];
    return { ...card, status: `This alarm was set on your device${weekday ? ` \u00b7 Repeats every ${weekday}` : ''}`, tone: 'ok' };
  }
  if (result.text.startsWith('Sent to the phone as a notification')) return { ...card, status: 'Sent to your phone: tap the notification to set it', tone: 'ok' };
  return { ...card, status: result.text, tone: 'error' };
}

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
    if (parent && parent !== e.id) {
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
    const back = list.find((e) => e.kind === 'tool_use' && e.name === HANDBACK);
    if (back && !results.has(id)) results.set(id, { id: `${id}:back`, kind: 'tool_result', toolUseId: id, text: '', isError: false, at: back.at });
  }
  return itemsFrom(top, results, children, resumed, progress);
}

// Steps of a sub-agent whose Agent call is on an earlier page get a stand-in for that call; its hand-back call ends it.
const HANDBACK = 'SubagentHandback';
function orphanAgent(id: string, at: number): ToolUse {
  return { kind: 'tool_use', id, at, name: 'Agent', input: { description: 'Sub-agent started earlier' }, summary: '' };
}

// open holds the agent calls being expanded, so a step that names an ancestor as its parent cannot loop.
function itemsFrom(events: ChatEvent[], results: Map<string, ToolResult>, children: Map<string, ChatEvent[]>, resumed: Map<string, number>, progress: Map<string, string>, open: ReadonlySet<string> = new Set()): Item[] {
  const items: Item[] = [];
  for (const e of events) {
    if (e.kind === 'user') items.push({ kind: 'user', id: e.id, text: e.text, at: e.at, stopping: e.stopping, queued: e.queued, voice: e.voice });
    else if (e.kind === 'assistant') { const text = stripRound(e.text); if (text.trim()) items.push({ kind: 'assistant', id: e.id, text, streaming: e.streaming }); }
    else if (e.kind === 'system') items.push({ kind: 'system', id: e.id, text: e.text, ...(e.error && { error: true }), ...(e.from && { from: e.from }) });
    else if (e.kind === 'blocked') items.push({ kind: 'blocked', id: e.id, ev: e });
    else if (e.kind === 'review') items.push({ kind: 'review', id: e.id, ev: e });
    else if (e.kind === 'tool_use' && !e.name.endsWith('__set_status')) {
      const result = results.get(e.id);
      const count = editCount(e.name, e.input);
      const path = typeof e.input.file_path === 'string' ? e.input.file_path : '';
      if (AGENT_TOOLS.has(e.name)) items.push({ kind: 'agent', id: e.id, use: e, result, running: !result || (resumed.get(e.id) ?? 0) > result.at, progress: progress.get(e.id) || null, steps: open.has(e.id) ? [] : itemsFrom(children.get(e.id) ?? [], results, children, resumed, progress, new Set([...open, e.id])) });
      else if (!count || !path) items.push({ kind: 'step', id: e.id, use: e, result });
      else {
        const error = result?.isError ? (denied(result) ? 'Denied' : firstLine(result.text)) : undefined;
        const prev = items[items.length - 1];
        if (!error && prev?.kind === 'file' && prev.path === path && !prev.error) {
          prev.uses.push(e);
          prev.count = { add: prev.count.add + count.add, del: prev.count.del + count.del };
          prev.pending = !result;
        } else items.push({ kind: 'file', id: e.id, path, count: error ? { add: 0, del: 0 } : count, uses: [e], error, ...(denied(result) && { denied: true }), ...(!result && { pending: true }) });
      }
    }
  }
  return items;
}

const TEXT_KINDS = new Set(['assistant', 'user', 'system', 'blocked', 'review']);
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

export type StepItem = Extract<Item, { kind: 'step' }>;

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// When a prompt was sent, for its hover row: Just now, 5m, 2h, then the date.
export function sentAt(at: number, now: number) {
  if (at <= 0) return '';
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  const d = new Date(at);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

export const isDocFile = (path: string) => /\.(md|markdown|mdx)$/i.test(path);

// The item that holds each Markdown file's doc card: its latest successful write or edit. Memory files stay in the work fold for its Remembered chip.
export function docCards(items: Item[]) {
  const latest = new Map<string, string>();
  for (const it of items) if (it.kind === 'file' && !it.error && isDocFile(it.path) && !MEMORY_FILE.test(it.path)) latest.set(it.path, it.id);
  return new Set(latest.values());
}

// Replies that arrived after the reader scrolled up, for the Jump to latest button.
export const newReplies = (items: Item[], lastSeenId: string) => items.slice(items.findIndex((it) => it.id === lastSeenId) + 1 || items.length).filter((it) => it.kind === 'assistant' && !it.streaming).length;

export type Rewind = { id: string; prompt: string; before?: string | null };

// The count line under a rewind's file list (Android Steps.kt rewindTotal).
export const rewindTotal = (n: number) => (n ? `${n} ${n === 1 ? 'file' : 'files'} changed` : 'No file changes');

export type RestoreChoice = 'code' | 'conversation' | 'both';
export const RESTORE_LABEL: Record<RestoreChoice, string> = { code: 'Code only', conversation: 'Conversation only', both: 'Code and conversation' };

// What the Rewind confirm offers and does (Android Steps.kt restorePlan): the conversation options fork from the reply before the prompt, so they need a provider that forks and a reply to fork from.
export function restorePlan(choice: RestoreChoice, canFork: boolean, hasBefore: boolean) {
  const choices: RestoreChoice[] = canFork && hasBefore ? ['code', 'conversation', 'both'] : ['code'];
  const picked = choices.includes(choice) ? choice : 'code';
  return { choices, files: picked !== 'conversation', fork: picked !== 'code' };
}

// The last reply before a prompt, where a conversation rewind forks from (Android Steps.kt replyBefore).
export function replyBefore(items: Item[], promptId: string) {
  let reply: string | null = null;
  for (const it of items) {
    if (it.id === promptId) return reply;
    if (it.kind === 'assistant') reply = it.id;
  }
  return null;
}

// The last reply of each prompt that changed files, with the prompt a rewind goes back to.
export function rewindReplies(items: Item[]) {
  const out = new Map<string, Rewind>();
  let prompt: Rewind | null = null;
  let reply = '';
  let changed = false;
  const flush = () => { if (prompt && reply && changed) out.set(reply, prompt); };
  for (const it of items) {
    if (it.kind === 'user') { flush(); prompt = { id: it.id, prompt: it.text }; reply = ''; changed = false; }
    else if (it.kind === 'assistant') reply = it.id;
    else if (it.kind === 'file' && !it.error && !it.denied) changed = true;
  }
  flush();
  return out;
}

const DOING: Record<string, string> = { Read: 'Reading', Edited: 'Editing', Wrote: 'Writing', Searched: 'Searching', Listed: 'Listing', Ran: 'Running', Fetched: 'Fetching', 'Searched the web for': 'Searching the web for', Delegated: 'Delegating', Called: 'Calling', Used: 'Using', 'Looked up': 'Looking up', Loaded: 'Loading', Pushed: 'Pushing', Created: 'Creating' };

// The step a running turn is on, named as it happens ("Running npm test…"), or '' when none waits on a result. Android Steps.kt runningStep says the same.
export function runningStep(items: Item[], cwd = '') {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const use = it.kind === 'step' && !it.result ? it.use : it.kind === 'agent' && it.running ? it.use : it.kind === 'file' && it.pending ? it.uses[it.uses.length - 1] : null;
    if (!use || use.name.endsWith('__set_status')) continue;
    return doingLabel(use, cwd);
  }
  return '';
}

// A tool call named as it happens: "Searching "foo" in src…".
export function doingLabel(use: ToolUse, cwd = '') {
  const l = stepLabel(use.name, use.input, cwd);
  return `${[DOING[l.verb] ?? l.verb, l.object].filter(Boolean).join(' ')}…`;
}

// The last reply of each finished turn, when nothing follows it in the turn: the answers that get a Copy action.
// A prompt or a system line ends a turn, and the running turn gets none yet.
export function turnAnswers(items: Item[], running = false) {
  const out = new Set<string>();
  let last: Item | undefined;
  const flush = () => { if (last?.kind === 'assistant' && !last.streaming) out.add(last.id); };
  for (const it of items) {
    if (it.kind === 'user' || it.kind === 'system') { flush(); last = undefined; }
    else last = it;
  }
  if (!running) flush();
  return out;
}

export function newMarker(items: Item[], ats: Map<string, number>, seen: number, openedAt: number) {
  if (seen <= 0) return null;
  return items.find((it) => it.kind !== 'user' && (ats.get(it.id) ?? 0) > seen && (ats.get(it.id) ?? 0) <= openedAt)?.id ?? null;
}

// The New line a chat opens at: only when a finished reply sits at or after it; android Steps.kt openAtNew says the same.
export function openAtNew(items: Item[], newId: string | null) {
  const at = newId ? items.findIndex((it) => it.id === newId) : -1;
  return at >= 0 && items.slice(at).some((it) => it.kind === 'assistant' && !it.streaming) ? newId : null;
}

// Runs of at least min finished Read, Grep, Glob and LS steps in a row, keyed by the first step's id, so the
// transcript folds each into one Explored row like Slack's compact message groups (the phone does the same).
export function exploreRuns(items: Item[], min = 3) {
  const rows = items.map((it) => ({ name: it.kind === 'step' ? it.use.name : null, ok: it.kind === 'step' && !!it.result && !it.result.isError }));
  return new Map(exploreRunsOf(rows, min).map(({ start, end }) => [items[start].id, items.slice(start, end) as StepItem[]]));
}

export function exploreLabel(steps: StepItem[]) {
  return exploreLabelOf(steps.map((s) => s.use.name));
}

export const fileMeta = (it: Extract<Item, { kind: 'file' }>, noun: string) => (it.uses[0].name === 'Write' ? `${noun} written` : `${noun} edited · +${it.count.add} -${it.count.del}`);

// Row memo: true when a rebuilt item renders the same as the old one.
export function sameItem(a: Item, b: Item): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  switch (a.kind) {
    case 'file': {
      const o = b as typeof a;
      return a.path === o.path && a.error === o.error && a.pending === o.pending && a.count.add === o.count.add && a.count.del === o.count.del && a.uses.length === o.uses.length && a.uses.every((u, i) => u === o.uses[i]);
    }
    case 'step': {
      const o = b as typeof a;
      return a.use === o.use && a.result === o.result;
    }
    case 'agent': {
      const o = b as typeof a;
      return a.use === o.use && a.result === o.result && a.running === o.running && a.progress === o.progress && a.steps.length === o.steps.length && a.steps.every((s, i) => sameItem(s, o.steps[i]));
    }
    case 'blocked':
    case 'review':
      return a.ev === (b as typeof a).ev;
    default: {
      const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
      const keys = Object.keys(x);
      return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
    }
  }
}
