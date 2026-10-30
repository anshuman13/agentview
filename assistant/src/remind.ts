import type { Database } from 'bun:sqlite';
import { isBlock } from '../../shared/util.js';
import { pushNtfy } from '../../server/src/integrations/notify.js';
import { deleteMeta, getMeta, pruneMeta, setMeta, textList, type Profile } from './db.js';
import { rollOver } from './rollover.js';
import { flushHeld } from './hold.js';
import { HUB_URL } from './slack.js';
import { webUrl } from './slackSave.js';
import { loop } from './once.js';
import { applyChanges } from './sync.js';
import { DAY } from './time.js';

const BEFORE = 10 * 60_000;
const LATE = 5 * 60_000;
const FRESH = 2 * 3600_000;
// No pushes from 17:00 to 08:00; tasks that fell due in that time go out with the first check of the morning, also when
// the midnight rollover has already moved them to the same time today.
const QUIET = { from: 17, to: 8 };
export const quiet = (now: number) => { const h = new Date(now).getHours(); return h >= QUIET.from || h < QUIET.to; };
function taskSince(now: number) {
  const morning = new Date(now).setHours(QUIET.to, 0, 0, 0);
  return now - morning < FRESH ? Math.min(now - FRESH, new Date(morning - DAY).setHours(QUIET.from, 0, 0, 0)) : now - FRESH;
}

type Meeting = { id: string; profile: string; title: string | null; starts_at: number | null; ends_at: number | null; people: string | null; calendar_url: string | null };
type Reminder = { key: string; title: string; body: string; url: string; actions?: string };

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Same rule as the web: sentences ending in "?" and bullets under a "Questions" heading.
function questionsIn(...texts: (string | null)[]) {
  const out: string[] = [];
  for (const text of texts) {
    let under = false;
    for (const raw of (text ?? '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^([-*\u2022]|\d+[.)])\s+/.test(line);
      const plain = line.replace(/^([-*\u2022]|\d+[.)]|#+)\s+/, '').replace(/\*+/g, '').replace(/\S+:\/\/\S+/g, '').trim();
      if (!bullet) under = /^(open )?questions:?$/i.test(plain);
      const found = under && bullet ? [plain] : plain.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((x) => x.endsWith('?'));
      for (const q of found.map((x) => x.trim()).filter((x) => x.length > 1)) if (!out.includes(q)) out.push(q);
    }
  }
  return out;
}

// The app makes the next copy of a repeating task when it is done, so a reminder offers no Done for one.
const repeats = (text: string | null) => /^\s*Repeats:/.test(text ?? '');

const section = (label: string, lines: string[]) => (lines.length ? `${label}:\n${lines.slice(0, 3).map((l) => `- ${clip(l)}`).join('\n')}` : '');

const hubAction = (label: string, path: string, profile: string, id: string) => `http, ${label}, ${HUB_URL}${path}?profile=${profile}&id=${encodeURIComponent(id)}, method=POST, clear=true`;

export function finishTask(db: Database, profile: Profile, id: string, now = Date.now()) {
  if (!db.prepare("SELECT 1 FROM items WHERE profile = ? AND id = ? AND deleted = 0").get(profile, id)) return false;
  applyChanges(db, [{ table: 'items', id, profile, updated_at: now, fields: { status: 'done' } }]);
  return true;
}

export function snoozeTask(db: Database, profile: Profile, id: string, now = Date.now()) {
  if (!db.prepare("SELECT 1 FROM items WHERE profile = ? AND id = ? AND deleted = 0").get(profile, id)) return false;
  applyChanges(db, [{ table: 'items', id, profile, updated_at: now, fields: { at: now + 3600_000, rolls: null, rolled_from: null } }]);
  return true;
}

// A heads-up before each meeting with what is still open from the last one, a nudge once its transcript is read and
// has left me actions, and one when a task falls due. A meeting with nothing for me gets no nudge.
export function dueReminders(db: Database, now = Date.now()): Reminder[] {
  const sent = (key: string) => getMeta(db, `remind:${key}`) != null;
  const out: Reminder[] = [];
  const soon = (db.prepare("SELECT * FROM meetings WHERE deleted = 0 AND starts_at > ? AND starts_at <= ? ORDER BY profile = 'work' DESC").all(now - LATE, now + BEFORE) as Meeting[]).filter((m) => !isBlock(m.id));
  const seen = new Set<string>();
  for (const m of soon) {
    const key = `start:${m.id}:${m.starts_at}`;
    if (seen.has(key) || sent(key)) continue;
    seen.add(key);
    const mins = Math.round((m.starts_at! - now) / 60_000);
    const open = db.prepare("SELECT title FROM items WHERE deleted = 0 AND status = 'open' AND profile = ? AND meeting_id IN (SELECT id FROM meetings WHERE profile = ? AND title = ? AND id != ?)").all(m.profile, m.profile, m.title, m.id) as { title: string | null }[];
    const people = (() => { try { return (JSON.parse(m.people ?? '[]') as string[]).join(', '); } catch { return m.people; } })();
    const prev = db.prepare('SELECT summary, notes, decisions FROM meetings WHERE deleted = 0 AND profile = ? AND title = ? AND id != ? AND starts_at < ? ORDER BY starts_at DESC LIMIT 1').get(m.profile, m.title, m.id, m.starts_at) as { summary: string | null; notes: string | null; decisions: string | null } | null;
    const body = [
      people && `With ${people}`,
      section('Open from last time', open.map((a) => a.title ?? '')),
      prev && section('Decided last time', textList(prev.decisions)),
      prev && section('Open questions', questionsIn(prev.summary, prev.notes)),
    ].filter(Boolean).join('\n');
    const url = webUrl(m.calendar_url);
    out.push({ key, title: `${m.title ?? 'Meeting'} ${mins < 1 ? 'starts now' : `in ${mins} min`}`, body, url: url ?? '', actions: url ? `view, Open, ${url}` : '' });
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
  const tasks = db.prepare("SELECT id, profile, title, text, at FROM items WHERE deleted = 0 AND status = 'open' AND COALESCE(source, '') NOT IN ('calendar', 'meeting') AND ((CAST(at AS INTEGER) > ?1 AND CAST(at AS INTEGER) <= ?2) OR (rolled_from IS NOT NULL AND CAST(at AS INTEGER) - ?3 > ?1 AND CAST(at AS INTEGER) - ?3 <= ?2))").all(taskSince(now), now, DAY) as { id: string; profile: string; title: string | null; text: string | null; at: number }[];
  for (const t of tasks) {
    const key = `task:${t.profile}:${t.id}:${Number(t.at)}`;
    if (sent(key)) continue;
    const first = (t.text ?? '').split('\n').map((l) => l.trim()).find(Boolean);
    const due = new Date(Number(t.at)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    out.push({ key, title: t.title ?? 'Task', body: [`Due ${due}`, first && clip(first, 120)].filter(Boolean).join('\n'), url: '', actions: [!repeats(t.text) && hubAction('Done', '/task/done', t.profile, t.id), hubAction('Snooze 1h', '/task/snooze', t.profile, t.id)].filter(Boolean).join('; ') });
  }
  return out;
}

export function startReminders(db: () => Database, every = 60_000) {
  loop('reminders', every, async () => {
    rollOver(db());
    pruneMeta(db(), 'remind:', Date.now() - 2 * DAY);
    if (quiet(Date.now())) return;
    await flushHeld(db());
    for (const r of dueReminders(db())) {
      const key = `remind:${r.key}`;
      setMeta(db(), key, String(Date.now()));
      if (!(await pushNtfy(r.title, '', r.body, r.url, r.actions).catch(() => false))) deleteMeta(db(), key);
    }
  });
}
