import type { LiveChat } from './protocol.js';

export type ActivityRow = { id: string; title: string; line: string; at: number; failed: boolean };

const LINE_MAX = 90;

// The outcome of a finished chat: the first sentence of its last reply.
export function outcomeLine(last: string | undefined) {
  const flat = (last ?? '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  return first.length > LINE_MAX ? `${first.slice(0, LINE_MAX - 1).trimEnd()}…` : first;
}

// Muse's activity feed: chats that finished today, newest first, each with its outcome and time.
export function activity(live: LiveChat[], skip: Set<string>, dayStart: number, max = 6): ActivityRow[] {
  return live
    .filter((c) => !c.running && !c.pending && !skip.has(c.id) && c.lastActive >= dayStart)
    .sort((a, b) => b.lastActive - a.lastActive)
    .slice(0, max)
    .map((c) => ({ id: c.id, title: c.title || 'Untitled', line: outcomeLine(c.last) || (c.failed ? 'Stopped with an error' : 'Finished'), at: c.lastActive, failed: Boolean(c.failed) }));
}
