import type { ChatEvent } from './protocol';

// The ids, oldest first, of the rows the transcript draws holding every word of the query, ignoring case: user prompts and each turn's last top-level reply; none under two characters. With no hit and an `at` (a message hit's time, whose reply may be an earlier one of its turn), the row that ends the turn holding that time. shared/fixtures/chat-find.json holds the cases.
export function findInChat(events: ChatEvent[], query: string, at: number | null = null): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const has = (e: { text: string }) => words.every((w) => e.text.toLowerCase().includes(w));
  const hits: string[] = [];
  const turns: { at: number; id: string }[] = [];
  let reply: { id: string; text: string } | undefined;
  const endTurn = () => { if (reply && has(reply)) hits.push(reply.id); reply = undefined; };
  for (const e of events) {
    if (e.kind === 'user') { endTurn(); turns.push({ at: e.at, id: e.id }); if (has(e)) hits.push(e.id); }
    else if (e.kind === 'assistant' && !e.parent) { reply = e; if (turns.length) turns[turns.length - 1].id = e.id; }
  }
  endTurn();
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
