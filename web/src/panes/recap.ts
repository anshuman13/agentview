import type { ChatEvent } from '../../../shared/protocol';
import { buildTurns } from './turns';
import { plural } from './util';

export type Recap = { turns: number; files: number; failed: number; pending: boolean };

// What happened in a chat after the last event the user saw; null when nothing is worth a line.
export function recap(events: ChatEvent[], lastSeen: string | null, pending: boolean): Recap | null {
  if (!lastSeen) return null;
  const i = events.findIndex((e) => e.id === lastSeen);
  if (i < 0 || i === events.length - 1) return null;
  const { turns } = buildTurns(events.slice(i + 1));
  const files = new Set(turns.flatMap((t) => t.files.map((f) => f.path))).size;
  const failed = turns.reduce((n, t) => n + t.commands.filter((c) => c.error).length, 0);
  const r = { turns: turns.filter((t) => t.prompt).length, files, failed, pending };
  return r.turns || r.files || r.failed || r.pending ? r : null;
}

export function recapText(r: Recap) {
  const parts = [r.turns > 0 && plural(r.turns, 'turn'), r.files > 0 && plural(r.files, 'file'), r.failed > 0 && plural(r.failed, 'failed command'), r.pending && 'pending'].filter(Boolean);
  return `Since you last looked: ${parts.join(', ')}`;
}

const key = (chat: string) => `agentview.seen.${chat}`;

export function readSeen(chat: string) {
  try { return localStorage.getItem(key(chat)); } catch { return null; }
}

export function markSeen(chat: string, events: ChatEvent[]) {
  const last = events.at(-1)?.id;
  if (!chat || !last) return;
  try { localStorage.setItem(key(chat), last); } catch {}
}
