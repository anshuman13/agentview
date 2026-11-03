import type { Database } from 'bun:sqlite';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readJsonSync } from '../../server/src/json.js';
import { DB_DIR, getMeta, setMeta } from './db.js';
import { run, slackConfig } from './slack.js';
import { scanHealth } from './scan.js';
import { PROFILE, webUrl } from './slackSave.js';
import { applyChanges } from './sync.js';
import { DAY, HOUR, ymd } from './time.js';

// Kept outside the repo in ~/.agentview/assistant/autopilot.json. enabled turns the assist mode on: every ask with a draft
// is pushed with a Send reply action. Inside the away window the hub answers tier A asks itself and sends one holding
// note per person; dry_run logs what it would send instead of sending.
export type Away = { from: string; to: string; backup?: string; note?: string };
export type AutopilotConfig = { enabled?: boolean; dry_run?: boolean; away?: Away; escalate?: string[]; dms?: boolean; channels?: string[]; min_confidence?: number };
export type Mode = 'off' | 'assist' | 'away';
export const TIERS = ['answer', 'hold', 'escalate'] as const;
export type Tier = (typeof TIERS)[number];
export type NewAsk = { id: string; url: string; from: string; chat: string; title: string; quote: string; urgent: boolean; draft?: string; tier?: Tier; confidence?: number; why?: string };
type Reply = { status: string; who: string; mode: string; tier: string | null };

export const HOUR_CAP = 10;
export const DAY_CAP = 40;
const HOLD_AGAIN = 3 * DAY;
const SLACK = 'mcp__claude_ai_Slack__';

const META = 'autopilot';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// The settings live in the hub's meta table, set from the Jobs page; a autopilot.json next to the database seeds them once.
export function autopilotConfig(db: Database, file = path.join(DB_DIR, 'autopilot.json')): AutopilotConfig {
  const raw = getMeta(db, META);
  if (raw) {
    try {
      return { dms: true, ...(JSON.parse(raw) as AutopilotConfig) };
    } catch {}
  }
  const seed = readJsonSync<AutopilotConfig | null>(file, null);
  return seed ? saveAutopilot(db, seed) : {};
}

// Keeps only the known fields in their proper shape and stores them.
export function saveAutopilot(db: Database, c: Record<string, unknown>): AutopilotConfig {
  const away = (c.away ?? {}) as Record<string, unknown>;
  const from = str(away.from), to = str(away.to);
  const clean: AutopilotConfig = {
    enabled: c.enabled === true || c.enabled === 1,
    dry_run: c.dry_run !== false && c.dry_run !== 0,
    away: { from: DATE.test(from) ? from : '', to: DATE.test(to) ? to : '', backup: str(away.backup), note: str(away.note) },
    escalate: Array.isArray(c.escalate) ? c.escalate.map(str).filter(Boolean) : typeof c.escalate === 'string' ? c.escalate.split(',').map((x) => x.trim()).filter(Boolean) : [],
    dms: c.dms !== false && c.dms !== 0,
    ...(Array.isArray(c.channels) ? { channels: c.channels.map(str).filter(Boolean) } : {}),
    min_confidence: typeof c.min_confidence === 'number' && c.min_confidence >= 0 && c.min_confidence <= 1 ? c.min_confidence : 0.8,
  };
  setMeta(db, META, JSON.stringify(clean));
  return clean;
}

export type Logged = { id: string; who: string | null; chat: string | null; tier: string | null; confidence: number | null; status: string; text: string | null; url: string | null; at: number };

// The settings, the mode now, what the scan watches and its last run, and the last asks seen with what was done, for the Jobs page.
export function autopilotState(db: Database, now = Date.now()) {
  const config = autopilotConfig(db);
  const slack = slackConfig();
  const watched = slack?.channels ?? [];
  const replies = db.prepare('SELECT id, who, chat, tier, confidence, status, text, url, COALESCE(sent_at, at) AS at FROM replies WHERE profile = ? ORDER BY COALESCE(sent_at, at) DESC LIMIT 15').all(PROFILE) as Logged[];
  const texts = config.away?.to ? { hold: holdNote(config.away), marker: marker(config.away) } : null;
  return { config, mode: modeOf(config, now), watched, covered: coveredChannels(config, watched), push: slack?.push ?? { from: 8, to: 17 }, texts, scan: scanHealth(db).find((h) => h.scan === 'slack') ?? null, replies };
}

// Which new asks get a push: urgent ones always; in away mode also escalations, which it never answers; in assist mode every
// ask with a draft in a covered chat, so Send reply is one tap.
export function toPush(mode: Mode, c: AutopilotConfig, watched: string[], asks: NewAsk[]) {
  if (mode === 'away') return asks.filter((a) => a.urgent || a.tier === 'escalate' || escalated(c, a.from));
  if (mode === 'assist') return asks.filter((a) => a.urgent || (a.draft?.trim() && channelAllowed(c, watched, a.chat)));
  return asks.filter((a) => a.urgent);
}

export function modeOf(c: AutopilotConfig, now = Date.now()): Mode {
  if (!c.enabled) return 'off';
  const a = c.away;
  if (a?.from && a?.to) {
    const d = ymd(now);
    if (d >= a.from && d <= a.to) return 'away';
  }
  return 'assist';
}

const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

export const marker = (a: Away) => `(auto-reply from Anshuman's assistant: he is away until ${pretty(a.to)}${a.backup ? `, ${a.backup} covers meanwhile` : ''})`;

export const holdNote = (a: Away) =>
  `Hi, this is an auto-reply: Anshuman is away until ${pretty(a.to)} and will see this when he is back.${a.backup ? ` ${a.backup} covers for him meanwhile.` : ''}${a.note ? ` ${a.note}` : ''}`;

// What the scan prompt adds while I am away, so drafts stay factual and name the backup.
export function awayLines(c: AutopilotConfig, now = Date.now()) {
  if (modeOf(c, now) !== 'away' || !c.away) return [];
  return [`I am away until ${c.away.to}${c.away.backup ? `; ${c.away.backup} covers for me` : ''}. A draft of tier answer must state only what the thread or ask_context says, with no promise of any action of mine.`];
}

export const escalated = (c: AutopilotConfig, from: string) => (c.escalate ?? []).some((n) => n.trim() && from.toLowerCase().includes(n.trim().toLowerCase()));

// The watched channels minus temp ones, unless the config names its own list.
export const coveredChannels = (c: AutopilotConfig, watched: string[]) => c.channels ?? watched.filter((n) => !/^te?mp[-_]/.test(n));

export function channelAllowed(c: AutopilotConfig, watched: string[], chat: string) {
  if (chat === 'DM') return c.dms !== false;
  return coveredChannels(c, watched).includes(chat.replace(/^#/, ''));
}

const reply = (db: Database, id: string) => db.prepare('SELECT status, who, mode, tier FROM replies WHERE profile = ? AND id = ?').get(PROFILE, id) as Reply | null;

export function recordAsks(db: Database, asks: NewAsk[], mode: Mode, now: number) {
  const add = db.prepare('INSERT OR IGNORE INTO replies (profile, id, who, chat, tier, confidence, why, mode, status, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const a of asks) add.run(PROFILE, a.id, a.from, a.chat, a.tier ?? null, a.confidence ?? null, a.why ?? null, mode, 'held', now);
}

export const sentCount = (db: Database, since: number) => (db.prepare("SELECT COUNT(*) AS n FROM replies WHERE profile = ? AND status IN ('sent', 'dry') AND sent_at > ?").get(PROFILE, since) as { n: number }).n;

export const underCaps = (db: Database, now: number) => sentCount(db, now - HOUR) < HOUR_CAP && sentCount(db, now - DAY) < DAY_CAP;

// One holding note per person per 3 days.
export const holdDue = (db: Database, who: string, now: number) =>
  !db.prepare("SELECT 1 FROM replies WHERE profile = ? AND status IN ('sent', 'dry') AND tier = 'hold' AND lower(who) = lower(?) AND sent_at > ?").get(PROFILE, who, now - HOLD_AGAIN);

// Posts text as a thread reply under the ask's permalink with the work account's Slack connector and returns the permalink of the post.
export async function postReply(url: string, text: string) {
  let posted: string | null = null;
  const done = tool('posted', 'Call once the message is posted.', { url: z.string().describe('Permalink of the message you posted') }, async (a) => {
    posted = a.url;
    return { content: [{ type: 'text' as const, text: 'noted' }] };
  });
  const prompt = [
    `Post the message below as a reply in the thread of ${url} with slack_send_message. The channel id is the path segment after /archives/, and the thread_ts is the p-number with a dot before its last 6 digits. Read the thread first only if you need its thread_ts. Post it exactly once, change nothing in the text, then call posted with the permalink and stop.`,
    '',
    text,
  ].join('\n');
  await run(prompt, 'haiku', [done], 8, () => posted != null, [`${SLACK}slack_send_message`, `${SLACK}slack_read_thread`]);
  if (!posted) throw new Error('The reply was not posted');
  return posted as string;
}

type Sent = { status: 'sent' | 'dry'; url: string | null };

// Sends one reply, or logs it in a dry run, and notes it on the task; an answer closes the task, a holding note leaves it.
export async function sendReply(db: Database, c: AutopilotConfig, ask: { id: string; url: string; from: string; chat: string }, tier: Tier, text: string, now: number, post = postReply): Promise<Sent> {
  const dry = c.dry_run !== false;
  let url: string | null = null;
  try {
    url = dry ? null : webUrl(await post(ask.url, text));
  } catch (err) {
    db.prepare("UPDATE replies SET status = 'error', text = ?, why = ? WHERE profile = ? AND id = ?").run(text, String(err), PROFILE, ask.id);
    throw err;
  }
  const status = dry ? 'dry' : 'sent';
  db.prepare('INSERT OR IGNORE INTO replies (profile, id, who, chat, mode, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(PROFILE, ask.id, ask.from, ask.chat, modeOf(c, now), 'held', now);
  db.prepare('UPDATE replies SET status = ?, tier = ?, text = ?, url = ?, sent_at = ? WHERE profile = ? AND id = ?').run(status, tier, text, url, now, PROFILE, ask.id);
  const row = db.prepare('SELECT text, updated_at FROM items WHERE profile = ? AND id = ? AND deleted = 0').get(PROFILE, ask.id) as { text: string | null; updated_at: number } | null;
  if (row) {
    // The ask may have been saved this same millisecond, and a same-time edit loses.
    const at = Math.max(now, row.updated_at + 1);
    const note = `${dry ? 'Autopilot would reply' : 'Autopilot replied'}${url ? ` ${url}` : ''}: ${text}`;
    const fields: Record<string, string | null> = { text: `${row.text ? `${row.text}\n\n` : ''}${note}` };
    if (tier === 'answer' && !dry) fields.status = 'done';
    applyChanges(db, [{ table: 'items', id: ask.id, profile: PROFILE, updated_at: at, fields }]);
  }
  return { status, url };
}

export type Outcome = { answered: string[]; held: string[]; skipped: string[] };

// Away mode after a scan: answers tier A asks that have a sure draft, sends one holding note per person for the rest, and
// never replies to an escalated person or outside the allowed channels. Returns what it did for the log.
export async function afterScan(db: Database, c: AutopilotConfig, watched: string[], asks: NewAsk[], now = Date.now(), post = postReply): Promise<Outcome> {
  const out: Outcome = { answered: [], held: [], skipped: [] };
  const mode = modeOf(c, now);
  if (mode === 'off') return out;
  recordAsks(db, asks, mode, now);
  if (mode !== 'away' || !c.away) return out;
  const min = c.min_confidence ?? 0.8;
  for (const a of asks) {
    const prev = reply(db, a.id);
    if (prev && prev.status !== 'held') continue;
    const tier: Tier = escalated(c, a.from) ? 'escalate' : (a.tier ?? 'hold');
    if (tier === 'escalate' || !channelAllowed(c, watched, a.chat) || !underCaps(db, now)) {
      out.skipped.push(a.title);
      continue;
    }
    try {
      if (tier === 'answer' && a.draft && (a.confidence ?? 0) >= min) {
        await sendReply(db, c, a, 'answer', `${marker(c.away)} ${a.draft}`, now, post);
        out.answered.push(a.title);
      } else if (holdDue(db, a.from, now)) {
        await sendReply(db, c, a, 'hold', holdNote(c.away), now, post);
        out.held.push(a.title);
      } else out.skipped.push(a.title);
    } catch (err) {
      console.error(`autopilot: ${a.title}:`, err);
      out.skipped.push(a.title);
    }
  }
  return out;
}

// Send reply pressed on a push, or on the ask: posts the stored draft as my own reply (no marker) and closes the ask.
export async function replyNow(db: Database, c: AutopilotConfig, id: string, now = Date.now(), post = postReply) {
  const row = db.prepare("SELECT id, source_url, people, draft, updated_at FROM items WHERE profile = ? AND id = ? AND deleted = 0 AND source = 'slack' AND status IN ('suggested', 'open')").get(PROFILE, id) as { id: string; source_url: string | null; people: string | null; draft: string | null; updated_at: number } | null;
  if (reply(db, id)?.status === 'sent') return { status: 'sent' as const, url: null };
  if (!row?.draft?.trim() || !row.source_url) return null;
  const [from = '', chat = 'DM'] = (row.people ?? '').split(' · ');
  const r = await sendReply(db, c, { id, url: row.source_url, from, chat }, 'answer', row.draft.trim(), now, post);
  if (r.status === 'dry') return r;
  applyChanges(db, [{ table: 'items', id, profile: PROFILE, updated_at: Math.max(now, row.updated_at + 1), fields: { status: 'done' } }]);
  return r;
}
