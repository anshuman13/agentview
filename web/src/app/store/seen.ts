import { apiUrl } from '../api';
import { getState, set } from './core';

const SEEN_URL = '/api/sessions/seen';

// Seen times live on the Mac, so every device clears the same unread marks.
export function loadSeen() {
  fetch(apiUrl(SEEN_URL)).then((r) => r.json()).then((seen) => {
    if (!seen || typeof seen !== 'object' || Array.isArray(seen)) return;
    seenLoaded = true;
    for (const id in before) if (before[id] < 0) before[id] = seen[id] ?? 0;
    set({ seen });
  }).catch(() => {});
}

// The seen time a chat had before this page last opened it, for the transcript's New line; -1 until the server's times load.
const before: Record<string, number> = {};
let seenLoaded = false;
export const seenBefore = (sessionId: string) => (sessionId in before ? before[sessionId] : seenLoaded ? getState().seen[sessionId] ?? 0 : -1);
export const forgetSeenBefore = (sessionId: string) => void delete before[sessionId];

// The stream connect reloads the server's times over this local one.
export function markSeen(sessionId: string | null | undefined) {
  if (!sessionId) return;
  if (!(sessionId in before)) before[sessionId] = seenLoaded ? getState().seen[sessionId] ?? 0 : -1;
  set((s) => ({ seen: { ...s.seen, [sessionId]: Date.now() } }));
  fetch(apiUrl(`${SEEN_URL}?id=${encodeURIComponent(sessionId)}`), { method: 'POST' }).catch(() => {});
}

// Slack's Mark as unread: the chat shows as Done until it is opened again.
export function markUnread(sessionId: string) {
  set((s) => ({ seen: { ...s.seen, [sessionId]: 0 } }));
  fetch(apiUrl(`${SEEN_URL}?id=${encodeURIComponent(sessionId)}&unread=1`), { method: 'POST' }).catch(() => {});
}
