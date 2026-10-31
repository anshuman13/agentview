import type { Database } from 'bun:sqlite';
import { isBlock } from '../../shared/util.js';
import { pushNtfy } from '../../server/src/integrations/notify.js';

const KEY = 'held:pushes';
const ALL_DAY = 20 * 3600_000;
// While ntfy fails the list is never cleared, so it keeps only the newest.
const MAX_HELD = 20;

type Held = { title: string; chat: string; meeting: string; id?: string };

// The calendar meeting running at now, skipping all-day events, time blocks and events with no other attendees.
export function meetingAt(db: Database, now: number) {
  const rows = db.prepare("SELECT id, title FROM meetings WHERE deleted = 0 AND starts_at <= ? AND ends_at > ? AND ends_at - starts_at < ? AND COALESCE(people, '') <> '[]'").all(now, now, ALL_DAY) as { id: string; title: string | null }[];
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
export async function pushOrHold(db: Database, title: string, chat: string, body: string, url: string, actions: string, now = Date.now(), id?: string) {
  const m = meetingAt(db, now);
  if (!m) return pushNtfy(title, chat, body, url, actions);
  const list = [...heldPushes(db), { title, chat, meeting: m.title ?? 'a meeting', id }].slice(-MAX_HELD);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(KEY, JSON.stringify(list));
  return true;
}

// The combined push for what was held, once no meeting is running; null while one is or nothing is held.
// Entries whose item I handled or deleted meanwhile are left out; raw counts all entries examined.
export function heldDue(db: Database, now = Date.now()) {
  const all = heldPushes(db);
  if (!all.length || meetingAt(db, now)) return null;
  const live = db.prepare("SELECT 1 FROM items WHERE id = ? AND deleted = 0 AND status = 'suggested'");
  const list = all.filter((h) => !h.id || live.get(h.id));
  const meeting = all[all.length - 1].meeting;
  return { raw: all.length, count: list.length, title: `${list.length} urgent while you were in ${meeting}`, body: list.map((h) => `- ${h.title}${h.chat ? ` (${h.chat})` : ''}`).join('\n') };
}

// Clears only the entries it examined, so one held while the push was on its way stays for the next.
export async function flushHeld(db: Database, now = Date.now()) {
  const due = heldDue(db, now);
  const seen = due ? heldPushes(db).slice(0, due.raw).map((h) => JSON.stringify(h)) : [];
  if (!due || (due.count && !(await pushNtfy(due.title, '', due.body, '').catch(() => false)))) return;
  const left = heldPushes(db).filter((h) => !seen.includes(JSON.stringify(h)));
  if (left.length) db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(KEY, JSON.stringify(left));
  else db.prepare('DELETE FROM meta WHERE key = ?').run(KEY);
}

const MAX_QUEUED = 20;

// Urgent asks wait in meta until a scan inside push hours sends them; one leaves the list only after its push succeeds or I have reviewed it.
export async function pushQueued<T extends { id: string }>(db: Database, key: string, urgent: T[], inHours: boolean, send: (a: T) => Promise<boolean>) {
  let queue: T[] = [];
  try {
    queue = JSON.parse((db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | null)?.value ?? '[]');
  } catch {}
  for (const a of urgent) if (!queue.some((q) => q.id === a.id)) queue.push(a);
  queue = queue.slice(-MAX_QUEUED);
  if (inHours) {
    const open = db.prepare("SELECT 1 FROM items WHERE id = ? AND deleted = 0 AND status = 'suggested'");
    const left: T[] = [];
    for (const a of queue) if (open.get(a.id) && !(await send(a).catch(() => false))) left.push(a);
    queue = left;
  }
  if (queue.length) db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, JSON.stringify(queue));
  else db.prepare('DELETE FROM meta WHERE key = ?').run(key);
}
