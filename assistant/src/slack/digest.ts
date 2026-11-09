import type { Database } from 'bun:sqlite';
import { PROFILE } from './slackSave.js';
import { modeOf, type AutopilotConfig } from './autopilot.js';
import { applyChanges } from '../core/sync.js';
import { pushNtfy } from '../../../server/src/integrations/notify.js';
import { ymd } from '../core/time.js';

const DIGEST_HOUR = 17;

type DigestRow = { id: string; who: string | null; chat: string | null; why: string | null; url: string | null; source_url: string | null; edited?: number };

// One JSON object per reply for the Overview card, with the reason cut to 6 words and only where the user wants to know why.
function digestRows(groups: [string, string, DigestRow[]][]) {
  return JSON.stringify(groups.flatMap(([, outcome, list]) => list.map((r) => ({
    id: r.id,
    who: r.who ?? '',
    chat: r.chat ?? '',
    outcome,
    reason: ['failed', 'skipped', 'escalated'].includes(outcome) ? (r.why ?? '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ') : '',
    edited: outcome === 'sent' && !!r.edited,
    url: r.url ?? r.source_url ?? '',
  }))));
}

// Once per away day, at the first scan from 17:00: a brief (kind away) with what the hub answered, held, escalated and
// skipped that day as rows, and one push with the counts. Returns the brief text, or null when none was due.
export async function awayDigest(db: Database, c: AutopilotConfig, now = Date.now(), push = pushNtfy) {
  if (modeOf(c, now) !== 'away' || new Date(now).getHours() < DIGEST_HOUR) return null;
  const id = `away:${ymd(now)}`;
  if (db.prepare('SELECT 1 FROM briefs WHERE profile = ? AND id = ?').get(PROFILE, id)) return null;
  const from = new Date(now).setHours(0, 0, 0, 0);
  const rows = db.prepare("SELECT r.id, r.who, r.chat, r.tier, r.status, r.url, r.why, i.title, i.source_url FROM replies r LEFT JOIN items i ON i.profile = r.profile AND i.id = r.id WHERE r.profile = ? AND COALESCE(r.sent_at, r.at) >= ? ORDER BY COALESCE(r.sent_at, r.at)").all(PROFILE, from) as { id: string; who: string | null; chat: string | null; tier: string | null; status: string; url: string | null; why: string | null; title: string | null; source_url: string | null }[];
  const sent = (s: string) => s === 'sent' || s === 'dry';
  const groups: [string, string, typeof rows][] = [
    ['Answered', 'answered', rows.filter((r) => sent(r.status) && r.tier === 'answer')],
    ['Held with a note', 'held', rows.filter((r) => sent(r.status) && r.tier === 'hold')],
    ['Escalated to you', 'escalated', rows.filter((r) => !sent(r.status) && (r.tier === 'escalate' || r.status === 'held'))],
    ['Skipped or failed', 'skipped', rows.filter((r) => !sent(r.status) && r.tier !== 'escalate' && r.status !== 'held')],
  ];
  const text = `Away day ${ymd(now)}${c.dry_run !== false ? ' (dry run)' : ''}`;
  applyChanges(db, [{ table: 'briefs', id, profile: PROFILE, updated_at: now, fields: { kind: 'away', text, rows: digestRows(groups), from_at: from, to_at: now } }]);
  await push('Away digest', '', groups.map(([title, , list]) => `${list.length} ${title.toLowerCase()}`).join(', '), '');
  return text;
}

// Once per weekday in assist mode, at the first scan from 17:00: a brief (kind day) with what I sent, skipped and left waiting
// from the asks of that day, and one push with the counts. Nothing when the day had no asks.
export async function dayDigest(db: Database, c: AutopilotConfig, now = Date.now(), push = pushNtfy) {
  const d = new Date(now);
  if (modeOf(c, now) !== 'assist' || d.getHours() < DIGEST_HOUR || d.getDay() === 0 || d.getDay() === 6) return null;
  const id = `day:${ymd(now)}`;
  if (db.prepare('SELECT 1 FROM briefs WHERE profile = ? AND id = ?').get(PROFILE, id)) return null;
  const from = d.setHours(0, 0, 0, 0);
  const rows = db.prepare("SELECT r.id, r.who, r.chat, r.status, r.url, r.why, COALESCE(r.edited, 0) AS edited, i.title, i.source_url, i.status AS item, i.draft, COALESCE(i.deleted, 0) AS gone FROM replies r LEFT JOIN items i ON i.profile = r.profile AND i.id = r.id WHERE r.profile = ? AND COALESCE(r.sent_at, r.at) >= ? ORDER BY COALESCE(r.sent_at, r.at)").all(PROFILE, from) as { id: string; who: string | null; chat: string | null; status: string; url: string | null; why: string | null; edited: number; title: string | null; source_url: string | null; item: string | null; draft: string | null; gone: number }[];
  if (!rows.length) return null;
  const open = (r: (typeof rows)[number]) => !r.gone && (r.item === 'suggested' || r.item === 'open');
  const sent = rows.filter((r) => r.status === 'sent' || r.status === 'dry');
  const groups: [string, string, typeof rows][] = [
    ['Sent', 'sent', sent],
    ['Failed', 'failed', rows.filter((r) => r.status === 'error')],
    ['Skipped', 'skipped', rows.filter((r) => r.status === 'skipped' || (r.status === 'held' && !open(r)))],
    ['Waiting for you', 'waiting', rows.filter((r) => r.status === 'held' && open(r))],
  ];
  const edited = sent.filter((r) => r.edited).length;
  const count = (title: string, n: number) => `${n} ${title.toLowerCase()}${title === 'Sent' && edited ? ` (${edited} edited)` : ''}`;
  const summary = groups.flatMap(([title, , list]) => (list.length ? [count(title, list.length)] : [])).join(', ');
  const text = 'Today in Slack';
  applyChanges(db, [{ table: 'briefs', id, profile: PROFILE, updated_at: now, fields: { kind: 'day', text, rows: digestRows(groups), from_at: from, to_at: now } }]);
  await push('Today', '', summary, '');
  return text;
}
