import type { ChatEvent } from '../../../../shared/protocol';

// A tail init for the chat on screen keeps the older events already held (paged in earlier) before the init's first id.
// They are kept only while the count before that id still adds up; a removed or moved event ahead of it breaks the count and the init alone stands.
export function mergeTail(held: ChatEvent[], heldEarlier: number, tail: ChatEvent[], earlier: number) {
  const at = tail.length ? held.findIndex((e) => e.id === tail[0].id) : -1;
  const kept = at >= 0 && heldEarlier + at === earlier ? held.slice(0, at) : [];
  return { events: [...kept, ...tail], earlier: Math.max(0, earlier - kept.length) };
}

export function initPage(held: ChatEvent[], heldEarlier: number, same: boolean, events: ChatEvent[], earlier?: number) {
  return same && earlier !== undefined ? mergeTail(held, heldEarlier, events, earlier) : { events, earlier: earlier ?? 0 };
}

// A chat left open at its latest row keeps only the last `keep` events once it holds more than `max`; the dropped count joins `earlier`.
export function trimHeld(events: ChatEvent[], earlier: number, max: number, keep: number) {
  if (events.length <= max || keep >= events.length) return { events, earlier };
  return { events: events.slice(-keep), earlier: earlier + events.length - keep };
}

// An older page goes in front only while the events still start where it was asked from; an init meanwhile wins.
export function prependPage(held: ChatEvent[], first: string, page: ChatEvent[], earlier: number) {
  return held[0]?.id === first ? { events: [...page, ...held], earlier } : null;
}
