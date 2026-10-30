import type { Database } from 'bun:sqlite';
import { pushNtfy } from '../../server/src/integrations/notify.js';
import { atRisk, minutesText, workGaps, type Span } from '../../shared/plan.js';
import { blockId, clock, isBlock } from '../../shared/util.js';
import { deleteMeta, getMeta, pruneMeta, setMeta, type Profile } from './db.js';
import { loop } from './once.js';
import { applyChanges } from './sync.js';
import { DAY, addWorkdays, inWeekHours, ymd } from './time.js';

const PROFILES: Profile[] = ['work', 'personal'];
const TOP = 5;
const LONG = 20 * 3600_000;
const KEEP = 60 * DAY;

type Row = { title: string | null };
export type Brief = { title: string; text: string; empty: boolean };

export const briefId = (now: number) => `morning:${ymd(now)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const top = <T extends Row>(rows: T[], tag: (r: T) => string = () => '') => [...rows.slice(0, TOP).map((r) => `- ${r.title ?? 'Untitled'}${tag(r)}`), ...(rows.length > TOP ? [`- +${rows.length - TOP} more`] : [])];

// Open tasks due this week that will not fit in the free work time before they are due; tasks with a focus block ahead are covered.
function riskCount(db: Database, profile: Profile, now: number) {
  const week = new Date(now).setHours(24 * 7, 0, 0, 0);
  const busy = db.prepare('SELECT starts_at, ends_at FROM meetings WHERE deleted = 0 AND profile = ? AND starts_at < ? AND ends_at > ? AND ends_at - starts_at < ?').all(profile, week, now, LONG) as { starts_at: number; ends_at: number }[];
  const tasks = db.prepare("SELECT i.title, CAST(i.at AS INTEGER) AS due FROM items i WHERE i.deleted = 0 AND i.profile = ? AND i.status = 'open' AND COALESCE(i.source, '') NOT IN ('calendar', 'meeting') AND i.at IS NOT NULL AND CAST(i.at AS INTEGER) < ? AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.profile = i.profile AND m.id = ? || i.id AND m.deleted = 0 AND m.ends_at > ?)").all(profile, week, blockId(''), now) as { title: string | null; due: number }[];
  return atRisk(tasks, busy.map((m) => [m.starts_at, m.ends_at] as Span), now).length;
}

// Today's meetings and free time, tasks due or overdue, tasks at risk this week, Slack asks to review, Slack promises of mine and meeting actions left from the last workday.
export function buildBrief(db: Database, profile: Profile, now = Date.now()): Brief {
  const start = new Date(now).setHours(0, 0, 0, 0);
  const end = new Date(now).setHours(24, 0, 0, 0);
  const busy = db.prepare('SELECT id, title, starts_at, ends_at FROM meetings WHERE deleted = 0 AND profile = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at').all(profile, start, end) as (Row & { id: string; starts_at: number; ends_at: number | null })[];
  const meetings = busy.filter((m) => !isBlock(m.id));
  const timed = busy.filter((m) => m.ends_at != null && m.ends_at > m.starts_at && m.ends_at - m.starts_at < LONG);
  const gaps = workGaps(timed.map((m) => [m.starts_at, m.ends_at!] as Span), start);
  const tasks = db.prepare("SELECT title, at FROM items WHERE deleted = 0 AND profile = ? AND status = 'open' AND COALESCE(source, '') NOT IN ('calendar', 'meeting') AND at IS NOT NULL AND CAST(at AS INTEGER) < ? ORDER BY CAST(at AS INTEGER)").all(profile, end) as (Row & { at: number })[];
  const late = tasks.filter((t) => Number(t.at) < now).length;
  const slack = db.prepare("SELECT id, title FROM items WHERE deleted = 0 AND profile = ? AND source = 'slack' AND status = 'suggested' ORDER BY updated_at DESC").all(profile) as (Row & { id: string })[];
  const said = slack.filter((r) => r.id.startsWith('said:'));
  const asks = slack.filter((r) => !said.includes(r));
  const left = db.prepare("SELECT i.title, i.status, m.title AS meeting FROM items i JOIN meetings m ON m.profile = i.profile AND m.id = i.meeting_id WHERE i.deleted = 0 AND i.profile = ? AND i.status IN ('open', 'suggested') AND m.deleted = 0 AND m.starts_at >= ? AND m.starts_at < ? ORDER BY m.starts_at").all(profile, addWorkdays(start, -1), start) as (Row & { status: string; meeting: string | null })[];

  const lines: string[] = [];
  if (meetings.length) {
    lines.push(`Meetings · ${meetings.length}`);
    for (const m of meetings) lines.push(`${timed.includes(m) ? `${clock(m.starts_at)}-${clock(m.ends_at!)}` : 'All day'} ${m.title ?? 'Meeting'}`);
  }
  const free = gaps.reduce((n, [a, b]) => n + b - a, 0);
  lines.push(gaps.length ? `Free ${minutesText(Math.round(free / 60_000))}: ${gaps.map(([a, b]) => `${clock(a)}-${clock(b)}`).join(', ')}` : 'No free time 08:00-17:00');
  if (tasks.length) lines.push('', `Tasks · ${tasks.length} due today${late ? `, ${late} overdue` : ''}`, ...top(tasks, (t) => (Number(t.at) < now ? ' (overdue)' : '')));
  const risk = riskCount(db, profile, now);
  if (risk) lines.push('', `At risk: ${plural(risk, 'task')}`);
  if (asks.length) lines.push('', `Slack asks to review · ${asks.length}`, ...top(asks));
  if (said.length) lines.push('', `You said · ${said.length}`, ...top(said));
  if (left.length) lines.push('', `Still open from last workday · ${left.length}`, ...top(left, (a) => `${a.meeting ? ` (${a.meeting})` : ''}${a.status === 'suggested' ? ' (yours?)' : ''}`));
  return {
    title: `Today: ${plural(meetings.length, 'meeting')}, ${plural(tasks.length, 'task')}`,
    text: lines.join('\n'),
    empty: !meetings.length && !tasks.length && !risk && !slack.length && !left.length,
  };
}

// Morning and Slack briefs past the keep window are no longer shown; their rows stay behind for sync without the text.
function pruneBriefs(db: Database, now = Date.now()) {
  const old = db.prepare("SELECT id, profile FROM briefs WHERE deleted = 0 AND kind IN ('morning', 'slack') AND to_at < ?").all(now - KEEP) as { id: string; profile: Profile }[];
  applyChanges(db, old.map((b) => ({ table: 'briefs', id: b.id, profile: b.profile, deleted: true, updated_at: now, fields: { text: null } })));
}

// Weekdays from 08:00 until 11:00 each profile with something on gets one brief stored for the phone and one push; a failed
// push or an empty brief retries, so a calendar imported later that morning still gets one.
export async function runBriefs(db: Database, now = Date.now(), push = pushNtfy) {
  if (!inWeekHours(now, 8, 11)) return [];
  pruneMeta(db, 'brief:', now - 2 * DAY);
  pruneBriefs(db, now);
  const sent: Profile[] = [];
  for (const profile of PROFILES) {
    const key = `brief:${profile}:${ymd(now)}`;
    if (getMeta(db, key) != null) continue;
    const id = briefId(now);
    const b = buildBrief(db, profile, now);
    if (b.empty) continue;
    setMeta(db, key, String(now));
    if (!db.prepare('SELECT 1 FROM briefs WHERE profile = ? AND id = ?').get(profile, id)) {
      applyChanges(db, [{ table: 'briefs', id, profile, updated_at: now, fields: { kind: 'morning', text: `${b.title}\n${b.text}`, from_at: new Date(now).setHours(0, 0, 0, 0), to_at: now } }]);
    }
    if (await push(b.title, profile === 'work' ? 'Work' : 'Personal', b.text, '').catch(() => false)) sent.push(profile);
    else deleteMeta(db, key);
  }
  return sent;
}

export function startBrief(db: () => Database, every = 60_000) {
  loop('brief', every, () => runBriefs(db()));
}
