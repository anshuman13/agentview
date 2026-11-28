import type { SavedSession } from '../../../shared/protocol.js';
import { provider, providerIds } from './registry.js';
import type { OtherChat } from './claude/search.js';
import type { MessageHit, Transcripts } from './types.js';

// Each transcript store once: Claude and OpenRouter share one.
export const transcriptStores = (): Transcripts[] => [...new Set(providerIds().map((id) => provider(id).transcripts))];

// Prompts and replies from every provider holding every word, newest first, at most 3 per chat.
export async function searchAll(words: string[], max = 50, stores = transcriptStores()): Promise<MessageHit[]> {
  if (!words.length) return [];
  const hits = (await Promise.all(stores.map((t) => t.search(words, max).catch(() => [] as MessageHit[])))).flat();
  hits.sort((a, b) => b.at.localeCompare(a.at));
  const per = new Map<string, number>();
  return hits.filter((h) => { const n = (per.get(h.sessionId) ?? 0) + 1; per.set(h.sessionId, n); return n <= 3; }).slice(0, max);
}

// Saved chats of every provider, each session once.
export async function listAll(stores = transcriptStores()): Promise<SavedSession[]> {
  const seen = new Set<string>();
  return (await Promise.all(stores.map((t) => t.list().catch(() => [] as SavedSession[])))).flat().filter((s) => !seen.has(s.sessionId) && !!seen.add(s.sessionId));
}

// Chats outside the Claude store holding every word, for the chat_search tool, which indexes Claude chats itself.
export async function otherChats(words: string[], stores = transcriptStores().filter((t) => t !== provider('claude').transcripts)): Promise<OtherChat[]> {
  const hits = await searchAll(words, 200, stores);
  if (!hits.length) return [];
  const byId = new Map((await listAll(stores)).map((s) => [s.sessionId, s]));
  const chats = new Map<string, OtherChat>();
  for (const h of hits) {
    const s = byId.get(h.sessionId);
    const c = chats.get(h.sessionId) ?? { sessionId: h.sessionId, cwd: s?.cwd ?? '', title: s?.title ?? '', hits: [] };
    c.hits.push(h);
    chats.set(h.sessionId, c);
  }
  return [...chats.values()];
}
