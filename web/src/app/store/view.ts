import { ROW_WINDOW, type ChatEvent } from '../../../../shared/protocol';
import { prependPage } from '../runtime/pageEvents';
import { getState, notice, set } from './core';
import { fetchEarlier } from './storeApi';

// The last rows of the most recently viewed chats, so switching back shows them before the server's init arrives.
const CACHED_CHATS = 8;
export const cache = new Map<string, { events: ChatEvent[]; earlier: number }>();

// boot is the server's start id. shownId is the chat the rows in `events` belong to; session.id still names the old chat after a cache hit.
// settled is whether the shown chat's init has arrived.
export const view = { boot: 0, shownId: '', settled: false };

export function cacheShown() {
  const { events, earlier } = getState();
  if (!view.shownId || !view.settled || !events.length) return;
  const kept = events.slice(-ROW_WINDOW);
  cache.delete(view.shownId);
  cache.set(view.shownId, { events: kept, earlier: (earlier ?? 0) + events.length - kept.length });
  if (cache.size > CACHED_CHATS) cache.delete(cache.keys().next().value!);
}

export function showCached(id: string) {
  if (id === view.shownId) return;
  const hit = cache.get(id);
  cacheShown();
  if (!hit) return;
  view.shownId = id;
  view.settled = false;
  set({ events: hit.events, earlier: hit.earlier });
}

// One page of events before the oldest held one; false when it did not arrive, with a notice unless the chat or server changed meanwhile.
export async function loadEarlier() {
  const chat = getState().session.id;
  const was = view.boot;
  const first = getState().events[0]?.id;
  // After a cache hit the rows belong to the chat being opened while session.id still names the old one.
  if (!first || view.shownId !== chat) return false;
  const stale = () => getState().session.id !== chat || view.boot !== was || Boolean(getState().ui.restarting);
  try {
    const r = await fetchEarlier(first, ROW_WINDOW);
    const body = await r.json();
    if (stale()) return false;
    if (!r.ok) throw new Error(body.error ?? `${r.status} ${r.statusText}`);
    const page = prependPage(getState().events, first, body.events, body.earlier);
    if (page) set(page);
    return Boolean(page);
  } catch (err) {
    if (!stale()) notice(`Could not load earlier messages: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
