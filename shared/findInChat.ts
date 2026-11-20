import type { ChatEvent } from './protocol';
import { matcher, queryWords } from './match';

// The ids, oldest first, of the user prompts and top-level replies holding every word of the query, ignoring case, the rule the sidebar message search uses; none under two characters. A reply inside a turn's work is found too: the transcript shows the fold that holds it. With no hit and an `at` (a message hit's time), the row that ends the turn holding that time. shared/fixtures/chat-find.json holds the cases.
export function findInChat(events: ChatEvent[], query: string, at: number | null = null): string[] {
  if (query.trim().length < 2) return [];
  const has = matcher(queryWords(query));
  const hits: string[] = [];
  const turns: { at: number; id: string }[] = [];
  for (const e of events) {
    if (e.kind === 'user') turns.push({ at: e.at, id: e.id });
    else if (e.kind === 'assistant' && !e.parent) { if (turns.length) turns[turns.length - 1].id = e.id; }
    else continue;
    if (has(e.text)) hits.push(e.id);
  }
  if (hits.length || at == null) return hits;
  const turn = turns.filter((t) => t.at <= at).pop() ?? turns[0];
  return turn ? [turn.id] : [];
}

// The index in hits of the hit whose event time is nearest `at`, the earliest on a tie; the last hit when `at` or every hit's time is missing. shared/fixtures/find-start.json holds the cases.
export function findStart(events: ChatEvent[], hits: string[], at: number | null): number {
  const last = Math.max(hits.length - 1, 0);
  if (at == null) return last;
  const times = new Map(events.map((e) => [e.id, e.at]));
  let best = -1;
  let gap = Infinity;
  hits.forEach((id, i) => {
    const t = times.get(id);
    if (!t || Math.abs(t - at) >= gap) return;
    best = i;
    gap = Math.abs(t - at);
  });
  return best < 0 ? last : best;
}
