import { replaceTarget } from '../../../../shared/claimActions';
import { costRise } from '../../../../shared/cost';
import type { ChatEvent } from '../../../../shared/protocol';
import { isSketchPath } from '../../../../shared/sketches';
import { money, plural } from '../../ui/util';
import { ALARM_TOOL, BUILD_TOOL, denied, docCards, duration, firstLine, MEMORY_FILE, type Item } from './steps';

export type Work = { tools: number; files: number; agents: number; failed: number; ms: number; cost: number; add: number; del: number; note?: string };

// What a fold without tool work holds: the one note's first line, else their count.
const noteOf = (it: Item) => ('text' in it ? firstLine(it.text) : '');
const notes = (items: Item[]) => (items.length === 1 ? noteOf(items[0]) : '') || (items.length > 0 ? plural(items.length, 'note') : '');

export type FoldRow =
  | { kind: 'item'; it: Item }
  | { kind: 'fold'; id: string; hidden: Item[]; work: Work; last: boolean; steps: StatusStep[]; now: string; thought: string; claims: Claim[]; proposed: Proposal[]; remembered: string[] };

export type Claim = { id: string; text: string; where: string };

const WIKI_READ = /(^|__)wiki_(search|page)$/;
const CLAIM_LINE = /^- \[([^\]]+)\] \([^)]*\) (.*)$/;
const CLAIM_WHERE = /^(.*) \(on (.+)\)$/;

// The claims a turn read: the `- [id] (...) text` lines of its wiki_search and wiki_page results, each id once. `- page [id]` lines do not match. Android WorkFold.kt claimsOf says the same.
export function claimsOf(items: Item[]): Claim[] {
  const out = new Map<string, Claim>();
  for (const it of items) {
    if (it.kind !== 'step' || !WIKI_READ.test(it.use.name) || !it.result || it.result.isError) continue;
    for (const line of it.result.text.split('\n')) {
      const m = CLAIM_LINE.exec(line);
      if (!m || out.has(m[1])) continue;
      const w = CLAIM_WHERE.exec(m[2]);
      out.set(m[1], { id: m[1], text: w ? w[1] : m[2], where: w ? w[2] : '' });
    }
  }
  return [...out.values()];
}

export type Proposal = { id: string; text: string };

const WIKI_PROPOSE = /(^|__)wiki_propose$/;
const PROPOSED = /^Proposed \[([^\]]+)\]/;

// The claims a turn proposed: its successful wiki_propose steps whose result starts "Proposed [id]", with the step's text, each id once. A refused call does not start so. Android WorkFold.kt proposedOf says the same.
export function proposedOf(items: Item[]): Proposal[] {
  const out = new Map<string, Proposal>();
  for (const it of items) {
    if (it.kind !== 'step' || !WIKI_PROPOSE.test(it.use.name) || !it.result || it.result.isError) continue;
    const m = PROPOSED.exec(it.result.text);
    if (m && !out.has(m[1])) out.set(m[1], { id: m[1], text: text(it.use.input.text) });
  }
  return [...out.values()];
}

export const isMemoryIndex = (path: string) => path.endsWith('/MEMORY.md');

// The memory files a turn wrote: its successful Write, Edit or MultiEdit steps on one, each path once, MEMORY.md only when it is the only one. Android WorkFold.kt rememberedOf says the same.
export function rememberedOf(items: Item[]): string[] {
  const paths = [...new Set(items.flatMap((it) => (it.kind === 'file' && !it.error && !it.pending && MEMORY_FILE.test(it.path) ? [it.path] : [])))];
  const files = paths.filter((p) => !isMemoryIndex(p));
  return files.length ? files : paths;
}

// What the hub mirror says of a proposed claim; Android WorkFold.kt proposalState says the same.
export const proposalState = (fact?: { state: string | null; deleted?: boolean | number }) => (!fact ? 'Not synced yet' : fact.deleted ? 'Deleted' : fact.state === 'proposed' ? 'Waiting' : fact.state === 'rejected' ? 'Rejected' : 'Approved');

type UsedFact = { id: string; profile: string; deleted?: number | boolean; state?: string | null; superseded_by?: string | null; contested?: string | null };

// What became of a claim a turn read: Gone (not in the mirror or deleted), Retired, Rejected, Replaced (a live claim took its place), Contested, else ''. Android WorkFold.kt usedClaimState says the same.
export function usedClaimState(facts: UsedFact[], id: string) {
  const f = facts.find((x) => x.id === id);
  if (!f || f.deleted) return 'Gone';
  if (f.state === 'retired') return 'Retired';
  if (f.state === 'rejected') return 'Rejected';
  const end = replaceTarget(facts, id, f.profile);
  if (end && end !== id) return 'Replaced';
  return f.contested ? 'Contested' : '';
}

export type StatusStep ={ id: string; title: string; done: boolean };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

type Tasks = { done: StatusStep[]; next: StatusStep[]; now: string };

// Each prompt's tasks from its top-level set_status calls: the finished ones (a repeated title keeps its first place), then the latest call's next list that is not done yet, and the latest status text.
function stepsByTurn(events: ChatEvent[]) {
  const out = new Map<string, Tasks>();
  let key = '';
  for (const e of events) {
    if (e.kind === 'user') key = e.id;
    if (e.kind !== 'tool_use' || e.parent || !e.name.endsWith('__set_status')) continue;
    const t = out.get(key) ?? { done: [], next: [], now: '' };
    out.set(key, t);
    const title = text(e.input.done);
    if (title && !t.done.some((s) => s.title === title)) t.done.push({ id: e.id, title, done: true });
    if (Array.isArray(e.input.next)) t.next = e.input.next.map(text).filter(Boolean).map((title, i) => ({ id: `${e.id}:${i}`, title, done: false }));
    t.now = text(e.input.text);
  }
  return out;
}

// Each prompt's latest thinking line; Android WorkFold.kt thoughtsByTurn says the same.
function thoughtsByTurn(events: ChatEvent[]) {
  const out = new Map<string, string>();
  let key = '';
  for (const e of events) {
    if (e.kind === 'user') key = e.id;
    if (e.kind === 'thinking') out.set(key, e.text);
  }
  return out;
}

const taskList = (t: Tasks | undefined): StatusStep[] => (t ? [...t.done, ...t.next.filter((n) => !t.done.some((d) => d.title === n.title))] : []);

type Span = { at: number; end: number; cost: number };

// Each prompt's time, the time of its last result and the cost its results add over the result before them (the first loaded result has none); rows before the first prompt belong to ''.
function spans(events: ChatEvent[], last: number | null) {
  const out = new Map<string, Span>([['', { at: events[0]?.at ?? 0, end: 0, cost: 0 }]]);
  let cur = out.get('')!;
  for (const e of events) {
    if (e.kind === 'user') out.set(e.id, (cur = { at: e.at, end: 0, cost: 0 }));
    else if (e.kind === 'result') {
      cur.end = e.at;
      if (e.costUsd > 0) { if (last !== null) cur.cost += costRise(e.costUsd, last); last = e.costUsd; }
    }
  }
  return out;
}

function workOf(items: Item[], span: Span): Work {
  const work: Work = { tools: 0, files: 0, agents: 0, failed: 0, ms: span.end > span.at ? span.end - span.at : 0, cost: span.cost, add: 0, del: 0 };
  const paths = new Set<string>();
  for (const it of items) {
    if (it.kind === 'step') { work.tools++; if (it.result?.isError && !denied(it.result)) work.failed++; }
    else if (it.kind === 'file') {
      work.tools += it.uses.length;
      work.add += it.count.add;
      work.del += it.count.del;
      if (it.error) { if (!it.denied) work.failed++; } else paths.add(it.path);
    } else if (it.kind === 'agent') {
      work.tools++;
      work.agents++;
      if (it.result?.isError && !denied(it.result)) work.failed++;
    }
  }
  work.files = paths.size;
  if (work.tools === 0) work.note = notes(items);
  return work;
}

// Splits the rows into turns, one per prompt, and moves the work of each into one fold placed above its last reply, or at its end while there is no reply.
// Android WorkFold.kt foldTurns says the same.
export function foldTurns(items: Item[], events: ChatEvent[], cards = docCards(items)): FoldRow[] {
  return foldGroups(items, events, cards, null, true);
}

// foldTurns over a run of whole turns; lastCost is the cost of the result before them, endsChat whether the run's last turn is the chat's last.
function foldGroups(items: Item[], events: ChatEvent[], cards: Set<string>, lastCost: number | null, endsChat: boolean): FoldRow[] {
  const prompts = new Set(events.filter((e) => e.kind === 'user').map((e) => e.id));
  const span = spans(events, lastCost);
  const steps = stepsByTurn(events);
  const thoughts = thoughtsByTurn(events);
  const groups: Item[][] = [];
  for (const it of items) {
    if (prompts.has(it.id) || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(it);
  }
  const out: FoldRow[] = [];
  groups.forEach((group, g) => {
    const first = group[0];
    const key = prompts.has(first.id) ? first.id : '';
    const reply = group.map((it) => it.kind).lastIndexOf('assistant');
    const hidden: Item[] = [];
    const rows: FoldRow[] = [];
    group.forEach((it, i) => {
      const shown = prompts.has(it.id) || i === reply || it.kind === 'blocked' || it.kind === 'review'
        || (it.kind === 'system' && Boolean(it.error))
        || (it.kind === 'file' && !it.error && (isSketchPath(it.path) || cards.has(it.id)))
        || (it.kind === 'step' && (it.use.name === ALARM_TOOL || it.use.name === BUILD_TOOL));
      if (!shown || it.kind === 'agent') hidden.push(it);
      if (shown) rows.push({ kind: 'item', it });
    });
    const tasks = steps.get(key);
    const last = endsChat && g === groups.length - 1;
    const thought = (last && thoughts.get(key)) || '';
    if (hidden.length > 0 || tasks || thought) {
      const fold: FoldRow = { kind: 'fold', id: key || first.id, hidden, work: workOf(hidden, span.get(key) ?? span.get('')!), last, steps: taskList(tasks), now: tasks?.now ?? '', thought, claims: claimsOf(hidden), proposed: proposedOf(hidden), remembered: rememberedOf(hidden) };
      const at = reply < 0 ? rows.length : rows.findIndex((r) => r.kind === 'item' && r.it === group[reply]);
      rows.splice(at, 0, fold);
    }
    out.push(...rows);
  });
  return out;
}

const sameList = <T>(a: T[], b: T[], same: (x: T, y: T) => boolean) => a.length === b.length && a.every((x, i) => same(x, b[i]));
const sameFields = (a: object, b: object) => {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => x[k] === y[k]);
};

function sameRow(a: FoldRow, b: FoldRow) {
  if (a.kind === 'item' || b.kind === 'item') return a.kind === 'item' && b.kind === 'item' && a.it === b.it;
  return a.id === b.id && a.last === b.last && a.now === b.now && a.thought === b.thought && sameFields(a.work, b.work)
    && sameList(a.hidden, b.hidden, Object.is)
    && sameList(a.steps, b.steps, sameFields)
    && sameList(a.claims, b.claims, sameFields)
    && sameList(a.proposed, b.proposed, sameFields)
    && sameList(a.remembered, b.remembered, Object.is);
}

const rowKey = (r: FoldRow) => (r.kind === 'item' ? `item:${r.it.id}` : `fold:${r.id}`);

const samePrefix = <T>(a: T[], b: T[], n: number) => {
  for (let i = n - 1; i >= 0; i--) if (a[i] !== b[i]) return false;
  return true;
};

type Settled = { events: ChatEvent[]; items: Item[]; cut: number; itemCut: number; cards: string; lastCost: number | null; rows: FoldRow[] };

// foldTurns that refolds only the last turn while the turns before it stay the same, and hands back the previous row object for every row that came out the same, so an append changes only the rows of its own turn.
export function createFoldBuilder() {
  let prev = new Map<string, FoldRow>();
  let settled: Settled | null = null;
  const reuse = (r: FoldRow) => {
    const old = prev.get(rowKey(r));
    return old && sameRow(old, r) ? old : r;
  };
  return (items: Item[], events: ChatEvent[], cards = docCards(items)): FoldRow[] => {
    let cut = events.length - 1;
    while (cut >= 0 && events[cut].kind !== 'user') cut--;
    const itemCut = cut < 0 ? -1 : items.findIndex((it) => it.id === events[cut].id);
    let rows: FoldRow[];
    if (itemCut < 0) {
      settled = null;
      rows = foldTurns(items, events, cards).map(reuse);
    } else {
      const head = items.slice(0, itemCut);
      const headCards = new Set(head.filter((it) => cards.has(it.id)).map((it) => it.id));
      const cardKey = [...headCards].join();
      if (!settled || settled.cut !== cut || settled.itemCut !== itemCut || settled.cards !== cardKey || !samePrefix(settled.events, events, cut) || !samePrefix(settled.items, items, itemCut)) {
        let lastCost: number | null = null;
        for (let i = cut - 1; i >= 0 && lastCost === null; i--) { const e = events[i]; if (e.kind === 'result' && e.costUsd > 0) lastCost = e.costUsd; }
        settled = { events, items, cut, itemCut, cards: cardKey, lastCost, rows: foldGroups(head, events.slice(0, cut), headCards, null, false).map(reuse) };
      }
      settled.events = events;
      settled.items = items;
      rows = [...settled.rows, ...foldGroups(items.slice(itemCut), events.slice(cut), cards, settled.lastCost, true).map(reuse)];
    }
    prev = new Map(rows.map((r) => [rowKey(r), r]));
    return rows;
  };
}

// The fold's title, or what it holds when no tool ran: its failed count apart so it can be drawn first in the error colour, and on a narrow screen the agents, duration and cost apart as a first line inside the fold. The duration waits for the turn to end.
export function workTitle(work: Work, live: boolean, billing: string, narrow = false) {
  const failed = work.failed > 0 ? `${work.failed} failed` : '';
  if (work.tools === 0 && work.note) return { text: work.note, failed, detail: '' };
  const counts = [
    work.tools > 0 && plural(work.tools, 'tool'),
    work.files > 0 && plural(work.files, 'file'),
  ];
  const rest = [
    work.agents > 0 && plural(work.agents, 'agent'),
    !live && duration(work.ms),
    billing === 'usd' && work.cost > 0 && money(work.cost),
  ];
  const join = (parts: (string | false)[]) => parts.filter(Boolean).join(' \u00b7 ');
  const text = join(narrow ? counts : [...counts, ...rest]);
  return { text: text || (failed ? '' : 'Work'), failed, detail: narrow ? join(rest) : '' };
}
