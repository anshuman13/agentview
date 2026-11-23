export const MAX_OUTBOX = 50;

// A message typed while the stream was down; the text keeps its [Image: ...] markers. A steer goes as a prompt or queue if its chat stopped or never ran.
export type Queued = { id: string; chat: string; text: string; steer: boolean; at: number; voice?: boolean };

export function parseOutbox(raw: unknown): Queued[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Queued => !!q && typeof q.id === 'string' && typeof q.chat === 'string' && typeof q.text === 'string')
    .map((q) => ({ id: q.id, chat: q.chat, text: q.text, steer: q.steer === true, at: Number(q.at) || 0, ...(q.voice === true && { voice: true }) }))
    .slice(0, MAX_OUTBOX);
}

// Null when the box is full, so the caller keeps the text in the composer.
export function addQueued(list: Queued[], q: Queued): Queued[] | null {
  return list.length >= MAX_OUTBOX ? null : [...list, q];
}

export const cancelQueued = (list: Queued[], id: string) => list.filter((q) => q.id !== id);

export const queuedFor = (list: Queued[], chat: string) => list.filter((q) => q.chat === chat);

export function queuedCommand(q: Queued, running: boolean) {
  return { type: running ? (q.steer ? 'steer' : 'queue') : 'prompt', text: q.text, id: q.id, ...(q.voice && { voice: true }) } as const;
}

// Sends the oldest first and stops at the first that fails, which stays queued; returns whether all went.
export async function flushQueue(read: () => Queued[], send: (q: Queued) => Promise<boolean>, done: (id: string) => void) {
  for (let next = read()[0]; next; next = read()[0]) {
    if (!(await send(next))) return false;
    done(next.id);
  }
  return true;
}
