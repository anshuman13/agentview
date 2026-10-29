import type { Cron } from '../agent/types.js';
import type { Repeat } from '../../../shared/protocol.js';

export type Saved = { sessionId: string; crons: Cron[]; repeat?: Repeat | null; queued?: { id: string; text: string }[] };

export function parseSaved(raw: string): { view?: string; chats: Saved[] } | null {
  let saved: any;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(saved?.chats)) return null;
  const chats = saved.chats
    .filter((c: any) => typeof c?.sessionId === 'string')
    .map((c: any) => ({ ...c, crons: Array.isArray(c.crons) ? c.crons : [] }));
  return { view: typeof saved.view === 'string' ? saved.view : undefined, chats };
}
