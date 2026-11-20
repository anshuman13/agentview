import type { ChatEvent } from './protocol';

// The ids, oldest first, of the prompts and top-level replies holding every word of the query, ignoring case; none under two characters. shared/fixtures/chat-find.json holds the cases.
export function findInChat(events: ChatEvent[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const hits: string[] = [];
  for (const e of events) {
    if (e.kind !== 'user' && !(e.kind === 'assistant' && !e.parent)) continue;
    const text = e.text.toLowerCase();
    if (words.every((w) => text.includes(w))) hits.push(e.id);
  }
  return hits;
}
