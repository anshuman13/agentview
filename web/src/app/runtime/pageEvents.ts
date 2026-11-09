import type { ChatEvent } from '../../../../shared/protocol';

// A tail init for the chat on screen keeps the older events already held (paged in earlier) before the init's first id.
export function mergeTail(held: ChatEvent[], tail: ChatEvent[], earlier: number) {
  const at = tail.length ? held.findIndex((e) => e.id === tail[0].id) : -1;
  const kept = at < 0 ? [] : held.slice(0, at);
  return { events: [...kept, ...tail], earlier: Math.max(0, earlier - kept.length) };
}

export function initPage(held: ChatEvent[], same: boolean, events: ChatEvent[], earlier?: number) {
  return same && earlier !== undefined ? mergeTail(held, events, earlier) : { events, earlier: earlier ?? 0 };
}

// An older page goes in front only while the events still start where it was asked from; an init meanwhile wins.
export function prependPage(held: ChatEvent[], first: string, page: ChatEvent[], earlier: number) {
  return held[0]?.id === first ? { events: [...page, ...held], earlier } : null;
}
