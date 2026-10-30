import type { Database } from 'bun:sqlite';
import { isBlock } from '../../shared/util.js';
import { pushNtfy } from '../../server/src/integrations/notify.js';

const KEY = 'held:pushes';
const ALL_DAY = 20 * 3600_000;

type Held = { title: string; chat: string; meeting: string };

// The calendar meeting running at now, skipping all-day events and time blocks.
export function meetingAt(db: Database, now: number) {
  const rows = db.prepare('SELECT id, title FROM meetings WHERE deleted = 0 AND starts_at <= ? AND ends_at > ? AND ends_at - starts_at < ?').all(now, now, ALL_DAY) as { id: string; title: string | null }[];
  return rows.find((m) => !isBlock(m.id));
}

export const heldPushes = (db: Database): Held[] => {
  try {
    return JSON.parse((db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as { value: string } | null)?.value ?? '[]');
  } catch {
    return [];
  }
};

// Sends an urgent push now, or keeps it in meta for one combined push when the meeting I am in ends.
export async function pushOrHold(db: Database, title: string, chat: string, body: string, url: string, actions: string, now = Date.now()) {
  const m = meetingAt(db, now);
  if (!m) return pushNtfy(title, chat, body, url, actions);
  const list = [...heldPushes(db), { title, chat, meeting: m.title ?? 'a meeting' }];
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(KEY, JSON.stringify(list));
  return true;
}

// The combined push for what was held, once no meeting is running; null while one is or nothing is held.
export function heldDue(db: Database, now = Date.now()) {
  const list = heldPushes(db);
  if (!list.length || meetingAt(db, now)) return null;
  const meeting = list[list.length - 1].meeting;
  return { title: `${list.length} urgent while you were in ${meeting}`, body: list.map((h) => `- ${h.title}${h.chat ? ` (${h.chat})` : ''}`).join('\n') };
}

export async function flushHeld(db: Database, now = Date.now()) {
  const due = heldDue(db, now);
  if (due && (await pushNtfy(due.title, '', due.body, '').catch(() => false))) db.prepare('DELETE FROM meta WHERE key = ?').run(KEY);
}
