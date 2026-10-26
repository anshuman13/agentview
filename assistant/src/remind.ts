import type { Database } from 'bun:sqlite';
import { pushNtfy } from '../../server/src/integrations/notify.js';

const BEFORE = 10 * 60_000;
const FRESH = 2 * 3600_000;
const DAY = 24 * 60 * 60_000;

type Meeting = { id: string; profile: string; title: string | null; starts_at: number | null; ends_at: number | null; people: string | null; calendar_url: string | null };
export type Reminder = { key: string; title: string; body: string; url: string };

// A heads-up before each meeting with what is still open from the last one, and a nudge once its transcript is read and
// has left me actions. A meeting with nothing for me gets no nudge.
export function dueReminders(db: Database, now = Date.now()): Reminder[] {
  const sent = (key: string) => db.prepare('SELECT 1 FROM meta WHERE key = ?').get(`remind:${key}`);
  const out: Reminder[] = [];
  const soon = db.prepare("SELECT * FROM meetings WHERE deleted = 0 AND starts_at > ? AND starts_at <= ? ORDER BY profile = 'work' DESC").all(now, now + BEFORE) as Meeting[];
  const seen = new Set<string>();
  for (const m of soon) {
    const key = `start:${m.id}:${m.starts_at}`;
    if (seen.has(key) || sent(key)) continue;
    seen.add(key);
    const mins = Math.max(1, Math.round((m.starts_at! - now) / 60_000));
    const open = db.prepare("SELECT title FROM items WHERE deleted = 0 AND status = 'open' AND profile = ? AND meeting_id IN (SELECT id FROM meetings WHERE profile = ? AND title = ? AND id != ?)").all(m.profile, m.profile, m.title, m.id) as { title: string | null }[];
    const people = (() => { try { return (JSON.parse(m.people ?? '[]') as string[]).join(', '); } catch { return m.people; } })();
    const body = [people && `With ${people}`, open.length > 0 && `Open from last time: ${open.map((a) => a.title).join('; ')}`].filter(Boolean).join('\n');
    out.push({ key, title: `${m.title ?? 'Meeting'} in ${mins} min`, body, url: m.calendar_url ?? '' });
  }
  const read = db.prepare("SELECT * FROM meetings WHERE deleted = 0 AND transcript = 'done' AND ends_at > ? AND CAST(json_extract(field_times, '$.transcript') AS INTEGER) > ?").all(now - DAY, now - FRESH) as Meeting[];
  for (const m of read) {
    const key = `actions:${m.profile}:${m.id}`;
    if (sent(key)) continue;
    const open = db.prepare("SELECT title, status FROM items WHERE deleted = 0 AND status IN ('open', 'suggested') AND profile = ? AND meeting_id = ?").all(m.profile, m.id) as { title: string | null; status: string }[];
    if (!open.length) continue;
    const review = open.filter((a) => a.status === 'suggested').length;
    out.push({ key, title: `${open.length} for you from ${m.title ?? 'a meeting'}${review ? ` · ${review} to confirm` : ''}`, body: open.map((a) => `- ${a.title}${a.status === 'suggested' ? ' (yours?)' : ''}`).join('\n'), url: '' });
  }
  const tasks = db.prepare("SELECT id, profile, title, at FROM items WHERE deleted = 0 AND status = 'open' AND source NOT IN ('calendar', 'meeting') AND CAST(at AS INTEGER) > ? AND CAST(at AS INTEGER) <= ?").all(now - BEFORE, now) as { id: string; profile: string; title: string | null; at: number }[];
  for (const t of tasks) {
    const key = `task:${t.profile}:${t.id}:${Number(t.at)}`;
    if (!sent(key)) out.push({ key, title: t.title ?? 'Task', body: 'Due now', url: '' });
  }
  return out;
}

export function startReminders(db: () => Database, every = 60_000) {
  setInterval(async () => {
    for (const r of dueReminders(db())) {
      if (await pushNtfy(r.title, '', r.body, r.url)) db().prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`remind:${r.key}`, String(Date.now()));
    }
  }, every).unref();
}
