import type { ChatEvent } from './protocol';

// The ids, oldest first, of the rows the transcript draws holding every word of the query, ignoring case: user prompts and each turn's last top-level reply; none under two characters. shared/fixtures/chat-find.json holds the cases.
export function findInChat(events: ChatEvent[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const has = (e: { text: string }) => words.every((w) => e.text.toLowerCase().includes(w));
  const hits: string[] = [];
  let reply: { id: string; text: string } | undefined;
  const endTurn = () => { if (reply && has(reply)) hits.push(reply.id); reply = undefined; };
  for (const e of events) {
    if (e.kind === 'user') { endTurn(); if (has(e)) hits.push(e.id); }
    else if (e.kind === 'assistant' && !e.parent) reply = e;
  }
  endTurn();
  return hits;
}
