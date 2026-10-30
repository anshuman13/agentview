import type { Database } from 'bun:sqlite';
import { pushNtfy } from '../../server/src/integrations/notify.js';
import { minutesText, workGaps, type Span } from '../../shared/plan.js';
import { clock, isBlock } from '../../shared/util.js';
import type { Profile } from './db.js';
import { applyChanges } from './sync.js';
import { inWeekHours } from './time.js';

const PROFILES: Profile[] = ['work', 'personal'];
const TOP = 5;
const LONG = 20 * 3600_000;

type Row = { title: string | null };
export type Brief = { title: string; text: string; empty: boolean };

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const briefId = (now: number) => `morning:${dayKey(now)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const top = <T extends Row>(rows: T[], tag: (r: T) => string = () => '') => [...rows.slice(0, TOP).map((r) => `- ${r.title ?? 'Untitled'}${tag(r)}`), ...(rows.length > TOP ? [`- +${rows.length - TOP} more`] : [])];

// The previous weekday: Friday on a Monday.
function lastWorkday(start: number) {
  const d = new Date(start);
  do d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  return d.getTime();
}

// Today's meetings and free time, tasks due or overdue, Slack asks to review and meeting actions left from the last workday.
export function buildBrief(db: Database, profile: Profile, now = Date.now()): Brief {
  const start = new Date(now).setHours(0, 0, 0, 0);
  const end = new Date(now).setHours(24, 0, 0, 0);
  const busy = db.prepare('SELECT id, title, starts_at, ends_at FROM meetings WHERE deleted = 0 AND profile = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at').all(profile, start, end) as (Row & { id: string; starts_at: number; ends_at: number | null })[];
  const meetings = busy.filter((m) => !isBlock(m.id));
  const timed = busy.filter((m) => m.ends_at != null && m.ends_at > m.starts_at && m.ends_at - m.starts_at < LONG);
  const gaps = workGaps(timed.map((m) => [m.starts_at, m.ends_at!] as Span), start);
  const tasks = db.prepare("SELECT title, at FROM items WHERE deleted = 0 AND profile = ? AND status = 'open' AND source NOT IN ('calendar', 'meeting') AND at IS NOT NULL AND CAST(at AS INTEGER) < ? ORDER BY CAST(at AS INTEGER)").all(profile, end) as (Row & { at: number })[];
  const late = tasks.filter((t) => Number(t.at) < now).length;
  const asks = db.prepare("SELECT title FROM items WHERE deleted = 0 AND profile = ? AND source = 'slack' AND status = 'suggested' ORDER BY updated_at DESC").all(profile) as Row[];
  const left = db.prepare("SELECT i.title, i.status, m.title AS meeting FROM items i JOIN meetings m ON m.profile = i.profile AND m.id = i.meeting_id WHERE i.deleted = 0 AND i.profile = ? AND i.status IN ('open', 'suggested') AND m.deleted = 0 AND m.starts_at >= ? AND m.starts_at < ? ORDER BY m.starts_at").all(profile, lastWorkday(start), start) as (Row & { status: string; meeting: string | null })[];

  const lines: string[] = [];
  if (meetings.length) {
    lines.push(`Meetings · ${meetings.length}`);
    for (const m of meetings) lines.push(`${timed.includes(m) ? `${clock(m.starts_at)}-${clock(m.ends_at!)}` : 'All day'} ${m.title ?? 'Meeting'}`);
  }
  const free = gaps.reduce((n, [a, b]) => n + b - a, 0);
  lines.push(gaps.length ? `Free ${minutesText(Math.round(free / 60_000))}: ${gaps.map(([a, b]) => `${clock(a)}-${clock(b)}`).join(', ')}` : 'No free time 08:00-17:00');
  if (tasks.length) lines.push('', `Tasks · ${tasks.length} due today${late ? `, ${late} overdue` : ''}`, ...top(tasks, (t) => (Number(t.at) < now ? ' (overdue)' : '')));
  if (asks.length) lines.push('', `Slack asks to review · ${asks.length}`, ...top(asks));
  if (left.length) lines.push('', `Still open from last workday · ${left.length}`, ...top(left, (a) => `${a.meeting ? ` (${a.meeting})` : ''}${a.status === 'suggested' ? ' (yours?)' : ''}`));
  return {
    title: `Today: ${plural(meetings.length, 'meeting')}, ${plural(tasks.length, 'task')}`,
    text: lines.join('\n'),
    empty: !meetings.length && !tasks.length && !asks.length && !left.length,
  };
}

// Weekdays from 08:00 until 11:00 each profile with something on gets one brief stored for the phone and one push; a failed
// push retries.
export async function runBriefs(db: Database, now = Date.now(), push = pushNtfy) {
  if (!inWeekHours(now, 8, 11)) return [];
  const sent: Profile[] = [];
  for (const profile of PROFILES) {
    const key = `brief:${profile}:${dayKey(now)}`;
    if (db.prepare('SELECT 1 FROM meta WHERE key = ?').get(key)) continue;
    const id = briefId(now);
    const b = buildBrief(db, profile, now);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(now));
    if (b.empty) continue;
    if (!db.prepare('SELECT 1 FROM briefs WHERE profile = ? AND id = ?').get(profile, id)) {
      applyChanges(db, [{ table: 'briefs', id, profile, updated_at: now, fields: { kind: 'morning', text: `${b.title}\n${b.text}`, from_at: new Date(now).setHours(0, 0, 0, 0), to_at: now } }]);
    }
    if (await push(b.title, profile === 'work' ? 'Work' : 'Personal', b.text, '').catch(() => false)) sent.push(profile);
    else db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  }
  return sent;
}

export function startBrief(db: () => Database, every = 60_000) {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runBriefs(db());
    } catch (err) {
      console.error('brief:', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }, every).unref();
}
