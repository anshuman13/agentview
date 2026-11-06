import type { AssistantStore, ReplyHistory } from './data/store';

const cache = new Map<string, Promise<ReplyHistory>>();
const keyOf = (who: string) => who.trim().toLowerCase();

// One request per person for the visit: a second row or a reopen reads the same answer until a reply to that person goes out.
export function loadHistory(store: AssistantStore, who: string) {
  const key = keyOf(who);
  let p = cache.get(key);
  if (!p) {
    p = store.replyHistory(who);
    cache.set(key, p);
    p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
  }
  return p;
}

export const clearHistory = (who: string | null | undefined) => void cache.delete(keyOf(who ?? ''));
