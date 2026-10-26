import type { Database } from 'bun:sqlite';
import { pushNtfy } from '../../server/src/integrations/notify.js';

const BEFORE = 10 * 60_000;
const AFTER = 30 * 60_000;
const DAY = 24 * 60 * 60_000;

type Meeting = { id: string; profile: string; title: string | null; starts_at: number | null; ends_at: number | null; people: string | null; calendar_url: string | null };
export type Reminder = { key: string; title: string; body: string; url: string };

// A heads-up before each meeting, and a nudge after one that left actions waiting for a decision.
export function dueReminders(db: Database, now = Date.now()): Reminder[] {
  const sent = (key: string) => db.prepare('SELECT 1 FROM meta WHERE key = ?').get(`remind:${key}`);
  const out: Reminder[] = [];
  const soon = db.prepare('SELECT * FROM meetings WHERE deleted = 0 AND starts_at > ? AND starts_at <= ?').all(now, now + BEFORE) as Meeting[];
  for (const m of soon) {
    const key = `start:${m.profile}:${m.id}:${m.starts_at}`;
    if (sent(key)) continue;
    const mins = Math.max(1, Math.round((m.starts_at! - now) / 60_000));
    const open = db.prepare("SELECT title FROM actions WHERE deleted = 0 AND status = 'proposed' AND meeting_id IN (SELECT id FROM meetings WHERE profile = ? AND title = ? AND id != ?)").all(m.profile, m.title, m.id) as { title: string | null }[];
    const people = (() => { try { return (JSON.parse(m.people ?? '[]') as string[]).join(', '); } catch { return m.people; } })();
    const body = [people && `With ${people}`, open.length > 0 && `Open from last time: ${open.map((a) => a.title).join('; ')}`].filter(Boolean).join('\n');
    out.push({ key, title: `${m.title ?? 'Meeting'} in ${mins} min`, body, url: m.calendar_url ?? '' });
  }
  const ended = db.prepare('SELECT * FROM meetings WHERE deleted = 0 AND ends_at > ? AND ends_at <= ?').all(now - DAY, now - AFTER) as Meeting[];
  for (const m of ended) {
    const key = `actions:${m.profile}:${m.id}`;
    if (sent(key)) continue;
    const open = db.prepare("SELECT title FROM actions WHERE deleted = 0 AND status = 'proposed' AND profile = ? AND meeting_id = ?").all(m.profile, m.id) as { title: string | null }[];
    if (!open.length) continue;
    out.push({ key, title: `${open.length} action${open.length > 1 ? 's' : ''} from ${m.title ?? 'a meeting'} need${open.length > 1 ? '' : 's'} you`, body: open.map((a) => `- ${a.title}`).join('\n'), url: '' });
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
