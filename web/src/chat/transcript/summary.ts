import { stripRound } from '../../../../shared/edits';
import type { ChatEvent } from '../../../../shared/protocol';
import { clock } from '../../../../shared/util';
import { agentSummary } from '../../sessions/agents';
import { plural } from '../../ui/util';
import { WOKE_UP } from './turns';
import { buildTranscript, exploreLabel, stepLabel, str, type Item, type ToolUse } from './steps';

export type SummaryEntry = { kind: 'status' | 'search' | 'page' | 'explore' | 'agent' | 'work'; id: string; at: number; title: string; meta: string; url?: string; failed?: boolean; running?: boolean };

type Step = Extract<Item, { kind: 'step' }>;
type Reply = Extract<ChatEvent, { kind: 'assistant' }>;

const EXPLORE = new Set(['Read', 'Grep', 'Glob', 'LS']);
const SEP = ' · ';

const startsTurn = (e?: ChatEvent) => e?.kind === 'user' || (e?.kind === 'system' && WOKE_UP.test(e.text));

// Splits events into turns exactly like turnsFrom in turns.ts, so the ids match Turn.id.
export function turnEvents(events: ChatEvent[]) {
  const turns: { id: string; events: ChatEvent[] }[] = [];
  const turnOf = new Map<string, (typeof turns)[number]>();
  for (const e of events) {
    if (startsTurn(e)) {
      turns.push({ id: e.id, events: [e] });
      continue;
    }
    const parent = e.kind === 'tool_use' ? e.parent : e.kind === 'tool_result' ? e.toolUseId : undefined;
    const turn = (parent && turnOf.get(parent)) || turns.at(-1) || turns[turns.push({ id: 'start', events: [] }) - 1];
    turnOf.set(e.id, turn);
    turn.events.push(e);
  }
  return turns;
}

// The last top-level reply of a turn, the one Turn.reply holds.
export const replyOf = (events: ChatEvent[]) => events.filter((e): e is Reply => e.kind === 'assistant' && !e.parent && stripRound(e.text).trim() !== '').at(-1);

const itemAt = (it: Item) => (it.kind === 'file' ? it.uses[0].at : 'use' in it ? it.use.at : 0);

function exploreEntry(steps: Step[]): SummaryEntry {
  const at = steps[0].use.at;
  return { kind: 'explore', id: steps[0].id, at, title: `Explored ${exploreLabel(steps)}`, meta: clock(at) };
}

function workEntry(items: Item[]): SummaryEntry {
  const steps = items.filter((it): it is Step => it.kind === 'step');
  const commands = steps.filter((s) => s.use.name === 'Bash');
  const files = new Set(items.flatMap((it) => (it.kind === 'file' ? [it.path] : [])));
  const others = steps.length - commands.length;
  const failed = commands.filter((s) => s.result?.isError).length;
  const title = [files.size > 0 && `edited ${plural(files.size, 'file')}`, commands.length > 0 && `ran ${plural(commands.length, 'command')}`, others > 0 && plural(others, 'other step')].filter(Boolean).join(', ');
  const at = itemAt(items[0]);
  return { kind: 'work', id: items[0].id, at, title: title[0].toUpperCase() + title.slice(1), meta: [clock(at), failed > 0 && `${failed} failed`].filter(Boolean).join(SEP) };
}

function build(events: ChatEvent[]) {
  const items = buildTranscript(events);
  const order = new Map(events.map((e, i) => [e.id, i]));
  const statuses = events.filter((e): e is ToolUse => e.kind === 'tool_use' && !e.parent && e.name.endsWith('__set_status'));
  const seq = [...items, ...statuses].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const entries: SummaryEntry[] = [];
  let run: { kind: 'explore' | 'work'; items: Item[] } | undefined;
  const close = () => {
    if (run) entries.push(run.kind === 'explore' ? exploreEntry(run.items as Step[]) : workEntry(run.items));
    run = undefined;
  };
  const add = (kind: 'explore' | 'work', it: Item) => {
    if (run?.kind !== kind) { close(); run = { kind, items: [] }; }
    run!.items.push(it);
  };
  let last = '';
  for (const it of seq) {
    if (it.kind === 'tool_use') {
      close();
      const key = `${str(it.input.text)}\n${str(it.input.done)}`;
      if (key !== last) entries.push({ kind: 'status', id: it.id, at: it.at, title: str(it.input.text), meta: [clock(it.at), str(it.input.done)].filter(Boolean).join(SEP) });
      last = key;
    } else if (it.kind === 'agent') {
      close();
      entries.push({ kind: 'agent', id: it.id, at: it.use.at, title: str(it.use.input.description) || 'Sub-agent', meta: [clock(it.use.at), agentSummary(it)].join(SEP), ...(it.running ? { running: true } : it.result?.isError && { failed: true }) });
    } else if (it.kind === 'step' && it.use.name === 'WebSearch') {
      close();
      entries.push({ kind: 'search', id: it.id, at: it.use.at, title: stepLabel(it.use.name, it.use.input).object, meta: [clock(it.use.at), 'Web search'].join(SEP) });
    } else if (it.kind === 'step' && it.use.name === 'WebFetch') {
      close();
      entries.push({ kind: 'page', id: it.id, at: it.use.at, title: stepLabel(it.use.name, it.use.input).object, meta: clock(it.use.at), url: str(it.use.input.url), ...(it.result?.isError && { failed: true }) });
    } else if (it.kind === 'step' && EXPLORE.has(it.use.name)) add('explore', it);
    else if (it.kind === 'step' || it.kind === 'file') add('work', it);
  }
  close();
  const startId = startsTurn(events[0]) ? events[0].id : '';
  const replyId = replyOf(events)?.id;
  return { entries, steps: items.filter((it) => it.id !== startId && it.id !== replyId).length };
}

const cache = new Map<string, { n: number; last?: ChatEvent; built: ReturnType<typeof build> }>();

// A turn whose event count and last event are unchanged returns the same entries.
function built(events: ChatEvent[]) {
  const key = events[0]?.id ?? '';
  const last = events.at(-1);
  const hit = cache.get(key);
  if (hit && hit.n === events.length && hit.last === last) return hit.built;
  const fresh = build(events);
  cache.set(key, { n: events.length, last, built: fresh });
  return fresh;
}

export const turnSummary = (events: ChatEvent[]) => built(events).entries;

// The turn's items less its prompt and reply, the number Turn.steps holds.
export const summarySteps = (events: ChatEvent[]) => built(events).steps;

export function summaryCounts(entries: SummaryEntry[], steps: number) {
  const searches = entries.filter((e) => e.kind === 'search').length;
  const pages = entries.filter((e) => e.kind === 'page').length;
  return [searches > 0 && `${searches} ${searches === 1 ? 'search' : 'searches'}`, pages > 0 && plural(pages, 'page'), steps > 0 && plural(steps, 'step')].filter((c): c is string => !!c);
}
