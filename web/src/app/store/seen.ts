import { mergeSeen, type SeenMark } from '../../../../shared/seen';
import { getState, set } from './core';
import { fetchSeen, postSeen } from './storeApi';

// This page's latest mark per chat. One whose POST failed is posted again when the stream opens, and each load keeps it over the server's time.
const marks: Record<string, SeenMark> = {};

function post(m: SeenMark) {
  postSeen(m.id, m.value === 0).then((ok) => {
    if (ok && marks[m.id] === m) marks[m.id] = { ...m, sent: true };
  });
}

function mark(id: string, value: number) {
  const m = { id, value, at: Date.now(), sent: false };
  marks[id] = m;
  set((s) => ({ seen: { ...s.seen, [id]: value } }));
  post(m);
}

// Seen times live on the Mac, so every device clears the same unread marks.
export function loadSeen() {
  const startedAt = Date.now();
  for (const id in marks) if (!marks[id].sent) post((marks[id] = { ...marks[id], at: startedAt }));
  fetchSeen().then((seen) => {
    if (!seen || typeof seen !== 'object' || Array.isArray(seen)) return;
    seenLoaded = true;
    for (const id in before) if (before[id] < 0) before[id] = seen[id] ?? 0;
    set({ seen: mergeSeen(seen, Object.values(marks), startedAt) });
    for (const id in marks) if (marks[id].sent && marks[id].at < startedAt) delete marks[id];
  }).catch(() => {});
}

// The seen time a chat had before this page last opened it, for the transcript's New line; -1 until the server's times load.
const before: Record<string, number> = {};
let seenLoaded = false;
export const seenBefore = (sessionId: string) => (sessionId in before ? before[sessionId] : seenLoaded ? getState().seen[sessionId] ?? 0 : -1);
export const forgetSeenBefore = (sessionId: string) => void delete before[sessionId];

export function markSeen(sessionId: string | null | undefined) {
  if (!sessionId) return;
  if (!(sessionId in before)) before[sessionId] = seenLoaded ? getState().seen[sessionId] ?? 0 : -1;
  mark(sessionId, Date.now());
}

// Slack's Mark as unread: the chat shows as Done until it is opened again.
export const markUnread = (sessionId: string) => mark(sessionId, 0);
