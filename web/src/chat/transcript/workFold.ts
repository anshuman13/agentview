import { costRise } from '../../../../shared/cost';
import type { ChatEvent } from '../../../../shared/protocol';
import { isSketchPath } from '../../../../shared/sketches';
import { plural } from '../../ui/util';
import { denied, duration, specCards, type Item } from './steps';

export type Work = { tools: number; files: number; agents: number; failed: number; ms: number; cost: number };

export type FoldRow =
  | { kind: 'item'; it: Item }
  | { kind: 'fold'; id: string; hidden: Item[]; work: Work; last: boolean };

type Span = { at: number; end: number; cost: number };

// Each prompt's time, the time of its last result and the cost its results add over the result before them (the first loaded result has none); rows before the first prompt belong to ''.
function spans(events: ChatEvent[]) {
  const out = new Map<string, Span>([['', { at: events[0]?.at ?? 0, end: 0, cost: 0 }]]);
  let cur = out.get('')!;
  let last: number | null = null;
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
  const work: Work = { tools: 0, files: 0, agents: 0, failed: 0, ms: span.end > span.at ? span.end - span.at : 0, cost: span.cost };
  const paths = new Set<string>();
  for (const it of items) {
    if (it.kind === 'step') { work.tools++; if (it.result?.isError && !denied(it.result)) work.failed++; }
    else if (it.kind === 'file') {
      work.tools += it.uses.length;
      if (it.error) { if (!it.denied) work.failed++; } else paths.add(it.path);
    } else if (it.kind === 'agent') {
      work.tools++;
      work.agents++;
      if (it.result?.isError && !denied(it.result)) work.failed++;
    }
  }
  work.files = paths.size;
  return work;
}

// Splits the rows into turns, one per prompt, and moves the work of each into one fold placed above its last reply, or at its end while there is no reply.
// Android WorkFold.kt foldTurns says the same.
export function foldTurns(items: Item[], events: ChatEvent[]): FoldRow[] {
  const prompts = new Set(events.filter((e) => e.kind === 'user').map((e) => e.id));
  const span = spans(events);
  const cards = specCards(items);
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
        || (it.kind === 'agent' && cards.has(it.id));
      if (!shown || it.kind === 'agent') hidden.push(it);
      if (shown) rows.push({ kind: 'item', it });
    });
    if (hidden.length > 0) {
      const fold: FoldRow = { kind: 'fold', id: key || first.id, hidden, work: workOf(hidden, span.get(key) ?? span.get('')!), last: g === groups.length - 1 };
      const at = reply < 0 ? rows.length : rows.findIndex((r) => r.kind === 'item' && r.it === group[reply]);
      rows.splice(at, 0, fold);
    }
    out.push(...rows);
  });
  return out;
}

// The fold's title, and its failed count apart so it can be drawn in the error colour. The duration waits for the turn to end.
export function workTitle(work: Work, live: boolean, billing: string) {
  const parts = [
    work.tools > 0 && plural(work.tools, 'tool'),
    work.files > 0 && plural(work.files, 'file'),
    work.agents > 0 && plural(work.agents, 'agent'),
    !live && duration(work.ms),
    billing === 'usd' && work.cost > 0 && `$${work.cost.toFixed(2)}`,
  ].filter(Boolean);
  const failed = work.failed > 0 ? `${work.failed} failed` : '';
  return { text: parts.join(' \u00b7 ') || (failed ? '' : 'Work'), failed };
}
