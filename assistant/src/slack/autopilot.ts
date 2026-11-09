import type { Database } from 'bun:sqlite';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readJsonSync } from '../../../server/src/json.js';
import { DB_DIR, getMeta, setMeta } from '../core/db.js';
import { run, slackConfig } from './slack.js';
import { spendSummary } from '../core/claude.js';
import { scanCosts, scanHealth } from '../core/scan.js';
import { NEEDS_ME, PROFILE, needsMe, threadKey, webUrl } from './slackSave.js';
import { liveClaims } from './draft.js';
import { applyChanges } from '../core/sync.js';
import { pushNtfy } from '../../../server/src/integrations/notify.js';
import { DAY, HOUR, ymd } from '../core/time.js';

// Kept outside the repo in ~/.agentview/assistant/autopilot.json. enabled turns the assist mode on: every ask with a draft
// is pushed with a Send reply action. auto_send (beta, off) turns on the away window: inside it the hub answers tier A asks
// itself and sends one holding note per person; dry_run logs what it would send instead of sending.
export type Away = { from: string; to: string; backup?: string; note?: string };
export type AutopilotConfig = { enabled?: boolean; auto_send?: boolean; dry_run?: boolean; away?: Away; escalate?: string[]; manager?: string; dms?: boolean; channels?: string[]; min_confidence?: number; model?: DraftModel };
type DraftModel = 'sonnet' | 'opus';
export type Mode = 'off' | 'assist' | 'away';
const TIERS = ['answer', 'hold', 'escalate'] as const;
type Tier = (typeof TIERS)[number];
export type NewAsk = { id: string; url: string; from: string; chat: string; title: string; quote: string; urgent: boolean; draft?: string; tier?: Tier; confidence?: number; why?: string; answered_by_other?: boolean; claims?: string[]; from_id?: string; external?: boolean };
type Reply = { status: string; who: string; mode: string; tier: string | null };

const HOUR_CAP = 10;
const DAY_CAP = 40;
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
    auto_send: c.auto_send === true || c.auto_send === 1,
    dry_run: c.dry_run !== false && c.dry_run !== 0,
    away: { from: DATE.test(from) ? from : '', to: DATE.test(to) ? to : '', backup: str(away.backup), note: str(away.note) },
    escalate: Array.isArray(c.escalate) ? c.escalate.map(str).filter(Boolean) : typeof c.escalate === 'string' ? c.escalate.split(',').map((x) => x.trim()).filter(Boolean) : [],
    manager: str(c.manager),
    model: c.model === 'opus' ? 'opus' : 'sonnet',
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
  return { config, mode: modeOf(config, now), watched, covered: coveredChannels(config, watched), push: slack?.push ?? { from: 8, to: 17 }, texts, scan: scanHealth(db).find((h) => h.scan === 'slack') ?? null, cost: scanCosts(db)[0] ?? null, spend: spendSummary(db, now), replies };
}

// Which new asks get a push: urgent ones always; in away mode also escalations, which it never answers; in assist mode every
// ask with a draft in a covered chat, so Send reply is one tap.
export function toPush(mode: Mode, c: AutopilotConfig, watched: string[], asks: NewAsk[], followups: string[] = []) {
  if (mode === 'away') return asks.filter((a) => a.urgent || a.tier === 'escalate' || escalated(c, a.from, a.from_id) || a.external || followups.includes(a.id));
  if (mode === 'assist') return asks.filter((a) => a.urgent || ((a.draft?.trim() || needsMe(a.tier)) && !a.answered_by_other && channelAllowed(c, watched, a.chat)));
  return asks.filter((a) => a.urgent);
}

export function modeOf(c: AutopilotConfig, now = Date.now()): Mode {
  if (!c.enabled) return 'off';
  const a = c.away;
  if (c.auto_send && a?.from && a?.to) {
    const d = ymd(now);
    if (d >= a.from && d <= a.to) return 'away';
  }
  return 'assist';
}

// The model for the scan and its drafts: the configured one in away mode, Sonnet otherwise.
export const scanModel = (c: AutopilotConfig, now = Date.now()): DraftModel => (modeOf(c, now) === 'away' && c.model === 'opus' ? 'opus' : 'sonnet');

// Midnight local at the start of the away window while it is on, else 0.
export function awayStart(c: AutopilotConfig, now = Date.now()) {
  return modeOf(c, now) === 'away' && c.away?.from ? new Date(`${c.away.from}T00:00:00`).getTime() : 0;
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

const USER_ID = /^[UW][A-Z0-9]{6,}$/;

// A never-answer entry matches a Slack user id exactly, or a name as whole words in who asked. The manager is always on the list.
export function escalated(c: AutopilotConfig, from: string, fromId?: string) {
  const who = from.toLowerCase();
  return [...(c.escalate ?? []), c.manager ?? ''].some((entry) => {
    const n = entry.trim();
    if (!n) return false;
    if (USER_ID.test(n)) return n === fromId;
    return new RegExp(`(^|[^a-z0-9])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(who);
  });
}

// Who the scan must never answer, for the prompt: the manager and the never-answer list.
export function escalateLines(c: AutopilotConfig) {
  const names = [...(c.manager ? [`${c.manager} (my manager)`] : []), ...(c.escalate ?? []).filter((n) => n.trim())];
  return names.length ? [`Asks from ${names.join(', ')} are tier escalate, whatever they ask.`] : [];
}

// The watched channels minus temp ones, unless the config names its own list.
const coveredChannels = (c: AutopilotConfig, watched: string[]) => c.channels ?? watched.filter((n) => !/^te?mp[-_]/.test(n));

export function channelAllowed(c: AutopilotConfig, watched: string[], chat: string) {
  if (chat === 'DM') return c.dms !== false;
  return coveredChannels(c, watched).includes(chat.replace(/^#/, ''));
}

const reply = (db: Database, id: string) => db.prepare('SELECT status, who, mode, tier FROM replies WHERE profile = ? AND id = ?').get(PROFILE, id) as Reply | null;

function recordAsks(db: Database, asks: NewAsk[], mode: Mode, now: number) {
  const add = db.prepare('INSERT OR IGNORE INTO replies (profile, id, who, chat, tier, confidence, why, mode, status, at, claims, thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const a of asks) add.run(PROFILE, a.id, a.from, a.chat, a.tier ?? null, a.confidence ?? null, a.why ?? null, mode, 'held', now, a.claims?.length ? JSON.stringify(a.claims) : null, threadKey(a.url));
}

// True when the hub already sent (or dry-ran) a reply in the thread of this ask, under another ask.
const threadReplied = (db: Database, a: { id: string; url: string }) =>
  !!db.prepare("SELECT 1 FROM replies WHERE profile = ? AND id != ? AND thread = ? AND status IN ('sent', 'dry')").get(PROFILE, a.id, threadKey(a.url));

const sentCount = (db: Database, since: number) => (db.prepare("SELECT COUNT(*) AS n FROM replies WHERE profile = ? AND status IN ('sent', 'dry') AND sent_at > ?").get(PROFILE, since) as { n: number }).n;

// The last few replies sent to a person, newest first, each cut to its first line, for the history in the Reply queue.
export const replyHistory = (db: Database, who: string) => {
  if (!who.trim()) return [];
  return (db.prepare("SELECT text, COALESCE(sent_at, at) AS at FROM replies WHERE profile = ? AND status IN ('sent', 'dry') AND lower(who) = lower(?) AND text IS NOT NULL ORDER BY COALESCE(sent_at, at) DESC LIMIT 3").all(PROFILE, who) as { text: string; at: number }[])
    .map((r) => {
      const line = (r.text.split('\n').find((l) => l.trim()) ?? '').trim();
      return { at: r.at, line: line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line };
    });
};

export const underCaps = (db: Database, now: number) => sentCount(db, now - HOUR) < HOUR_CAP && sentCount(db, now - DAY) < DAY_CAP;

// One holding note per person per 3 days.
export const holdDue = (db: Database, who: string, now: number) =>
  !db.prepare("SELECT 1 FROM replies WHERE profile = ? AND status IN ('sent', 'dry') AND tier = 'hold' AND lower(who) = lower(?) AND sent_at > ?").get(PROFILE, who, now - HOLD_AGAIN);

export const ANSWERED = 'answered';
export const CHANGED = 'changed';

// Posts text as a thread reply under the ask's permalink with the work account's Slack connector and returns the permalink of
// the post, or ANSWERED when a re-read of the thread shows someone else answered since the scan.
export async function postReply(url: string, text: string) {
  let posted: string | null = null;
  const done = tool('posted', 'Call once the message is posted, or once you decided not to post.', { url: z.string().describe(`Permalink of the message you posted, "${ANSWERED}" when someone else already answered, or "${CHANGED}" when the thread moved on`) }, async (a) => {
    posted = a.url;
    return { content: [{ type: 'text' as const, text: 'noted' }] };
  });
  const prompt = [
    `Read the thread of ${url} with slack_read_thread. The channel id is the path segment after /archives/, and the thread_ts is the p-number with a dot before its last 6 digits. If a reply after that message, from someone other than its author, already answers it, do not post: call posted with "${ANSWERED}" and stop. If the author has since withdrawn the ask, answered it themselves, or changed it so the message below no longer fits, do not post: call posted with "${CHANGED}" and stop.`,
    `Otherwise post the message below as a reply in that thread with slack_send_message, exactly once, changing nothing in the text, then call posted with the permalink and stop.`,
    '',
    text,
  ].join('\n');
  await run(prompt, 'haiku', [done], 8, () => posted != null, [`${SLACK}slack_send_message`, `${SLACK}slack_read_thread`]);
  if (!posted) posted = await verifyPost(url, text);
  if (!posted) throw new Error('The reply was not posted');
  return posted as string;
}

// When the post run ended without calling posted, reads the thread once more: the message may have gone out anyway.
async function verifyPost(url: string, text: string) {
  let found: string | null = null;
  const done = tool('found', 'Call once with what you found.', { url: z.string().describe('Permalink of the posted message, or "none"') }, async (a) => {
    found = a.url === 'none' ? null : a.url;
    return { content: [{ type: 'text' as const, text: 'noted' }] };
  });
  const prompt = [
    `Read the thread of ${url} with slack_read_thread (channel id after /archives/, thread_ts is the p-number with a dot before its last 6 digits). If a reply there has exactly the text below, call found with its permalink; otherwise call found with "none". Do not post anything.`,
    '',
    text,
  ].join('\n');
  try {
    await run(prompt, 'haiku', [done], 4, () => found != null, [`${SLACK}slack_read_thread`]);
  } catch (err) {
    console.error('autopilot verify:', err);
  }
  return found as string | null;
}

type Sent = { status: 'sent' | 'dry' | 'answered' | 'changed'; url: string | null };

// Sends one reply, or logs it in a dry run, and notes it on the task; an answer closes the task, a holding note leaves it.
export async function sendReply(db: Database, c: AutopilotConfig, ask: { id: string; url: string; from: string; chat: string }, tier: Tier, text: string, now: number, post = postReply): Promise<Sent> {
  const dry = c.dry_run !== false;
  let url: string | null = null;
  // The row exists before the post, so a failed post is kept for the retry and the digest.
  db.prepare('INSERT OR IGNORE INTO replies (profile, id, who, chat, mode, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(PROFILE, ask.id, ask.from, ask.chat, modeOf(c, now), 'held', now);
  try {
    const r = dry ? null : await post(ask.url, text);
    if (r === ANSWERED) {
      db.prepare("UPDATE replies SET status = 'skipped', tier = ?, why = 'someone else answered' WHERE profile = ? AND id = ?").run(tier, PROFILE, ask.id);
      return { status: 'answered', url: null };
    }
    // The ask is still open but the draft no longer fits: the held row says so, and the ask stays on the card.
    if (r === CHANGED) {
      db.prepare("UPDATE replies SET status = 'held', tier = ?, why = 'thread changed since draft' WHERE profile = ? AND id = ?").run(tier, PROFILE, ask.id);
      return { status: 'changed', url: null };
    }
    url = r ? webUrl(r) : null;
  } catch (err) {
    db.prepare("UPDATE replies SET status = 'error', text = ?, why = ?, tries = COALESCE(tries, 0) + 1 WHERE profile = ? AND id = ?").run(text, String(err), PROFILE, ask.id);
    throw err;
  }
  const status = dry ? 'dry' : 'sent';
  db.prepare('UPDATE replies SET status = ?, tier = ?, text = ?, url = ?, sent_at = ?, why = NULL, tries = NULL WHERE profile = ? AND id = ?').run(status, tier, text, url, now, PROFILE, ask.id);
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

// followups: asks it did not answer that I must see, pushed in away mode: a second ask in a thread or within 3 days of a holding note.
type Outcome = { answered: string[]; held: string[]; skipped: string[]; followups: string[] };

export const MAX_TRIES = 3;
type Failed = { id: string; who: string; chat: string; tier: Tier; text: string; tries: number; url: string | null; title: string | null; why: string | null };

// Posts that failed on an earlier scan, with their ask, while they still have tries left or need the one push.
export const failedReplies = (db: Database) => db.prepare(
  "SELECT r.id, r.who, r.chat, r.tier, r.text, COALESCE(r.tries, 0) AS tries, r.why, i.source_url AS url, i.title FROM replies r LEFT JOIN items i ON i.profile = r.profile AND i.id = r.id AND i.deleted = 0 WHERE r.profile = ? AND r.status = 'error' AND r.text IS NOT NULL AND COALESCE(r.tries, 0) <= ?",
).all(PROFILE, MAX_TRIES) as Failed[];

// Retries each failed post, up to MAX_TRIES in all; after the last failure it pushes me once and stops trying.
async function retryFailed(db: Database, c: AutopilotConfig, now: number, post = postReply, push = pushNtfy) {
  const out = { answered: [] as string[], held: [] as string[] };
  for (const f of failedReplies(db)) {
    const title = f.title ?? f.id;
    if (f.tries >= MAX_TRIES) {
      if (await push('Reply failed 3 times', f.chat, `${f.who}: ${title}. ${f.why ?? ''}`.trim(), f.url ?? '')) db.prepare("UPDATE replies SET tries = ? WHERE profile = ? AND id = ?").run(MAX_TRIES + 1, PROFILE, f.id);
      continue;
    }
    if (!f.url || !underCaps(db, now)) continue;
    try {
      const r = await sendReply(db, c, { id: f.id, url: f.url, from: f.who, chat: f.chat }, f.tier ?? 'hold', f.text, now, post);
      if (r.status === 'sent' || r.status === 'dry') (f.tier === 'answer' ? out.answered : out.held).push(title);
    } catch (err) {
      console.error(`autopilot retry: ${title}:`, err);
    }
  }
  return out;
}

// Away mode after a scan: answers tier A asks that have a sure draft, sends one holding note per person for the rest, and
// never replies to an escalated person or outside the allowed channels. Returns what it did for the log.
export async function afterScan(db: Database, c: AutopilotConfig, watched: string[], asks: NewAsk[], now = Date.now(), post = postReply, push = pushNtfy): Promise<Outcome> {
  const out: Outcome = { answered: [], held: [], skipped: [], followups: [] };
  const mode = modeOf(c, now);
  if (mode === 'off') return out;
  recordAsks(db, asks, mode, now);
  // In assist mode the only failed posts are Sends I pressed, so they retry for real even in a dry run.
  if (mode !== 'away' || !c.away) {
    if (mode === 'assist') out.answered.push(...(await retryFailed(db, { ...c, dry_run: false }, now, post, push)).answered);
    return out;
  }
  const again = await retryFailed(db, c, now, post, push);
  out.answered.push(...again.answered);
  out.held.push(...again.held);
  const min = c.min_confidence ?? 0.8;
  for (const a of asks) {
    const prev = reply(db, a.id);
    if (prev && prev.status !== 'held') continue;
    if (threadReplied(db, a)) {
      db.prepare("UPDATE replies SET status = 'skipped', why = 'follow-up in a thread it already answered' WHERE profile = ? AND id = ?").run(PROFILE, a.id);
      out.followups.push(a.id);
      out.skipped.push(a.title);
      continue;
    }
    // A tier answer must rest on a claim that is still live; without one it is a hold.
    const tier: Tier = escalated(c, a.from, a.from_id) || a.external ? 'escalate' : a.tier === 'answer' && !liveClaims(db, a.claims ?? []).length ? 'hold' : (a.tier ?? 'hold');
    if (a.answered_by_other || tier === 'escalate' || !channelAllowed(c, watched, a.chat) || !underCaps(db, now)) {
      out.skipped.push(a.title);
      continue;
    }
    try {
      if (tier === 'answer' && a.draft && (a.confidence ?? 0) >= min) {
        const r = await sendReply(db, c, a, 'answer', `${marker(c.away)} ${a.draft}`, now, post);
        (r.status === 'sent' || r.status === 'dry' ? out.answered : out.skipped).push(a.title);
      } else if (holdDue(db, a.from, now)) {
        const r = await sendReply(db, c, a, 'hold', holdNote(c.away), now, post);
        (r.status === 'sent' || r.status === 'dry' ? out.held : out.skipped).push(a.title);
      } else {
        db.prepare("UPDATE replies SET status = 'skipped', why = 'second ask within 3 days of a holding note' WHERE profile = ? AND id = ?").run(PROFILE, a.id);
        out.followups.push(a.id);
        out.skipped.push(a.title);
      }
    } catch (err) {
      console.error(`autopilot: ${a.title}:`, err);
      out.skipped.push(a.title);
    }
  }
  return out;
}

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

// Send reply pressed on a push, or on the ask: posts the draft as my own reply (no marker) and closes the ask. I pressed
// Send, so it posts even in a dry run. text is the draft as edited on the phone, which may not have synced yet.
// edited says I changed the draft before sending, for the sent-unchanged measure.
export async function replyNow(db: Database, c: AutopilotConfig, id: string, now = Date.now(), post = postReply, edited = false, text?: string) {
  const row = db.prepare("SELECT id, source_url, people, draft, tags, updated_at FROM items WHERE profile = ? AND id = ? AND deleted = 0 AND source = 'slack' AND status IN ('suggested', 'open')").get(PROFILE, id) as { id: string; source_url: string | null; people: string | null; draft: string | null; tags: string | null; updated_at: number } | null;
  const held = reply(db, id);
  if (held?.status === 'sent') return { status: 'sent' as const, url: null };
  const draft = (text ?? row?.draft ?? '').trim();
  if (!row || !draft || !row.source_url) return null;
  const [from = '', chat = 'DM'] = (row.people ?? '').split(' · ');
  // The scan's tier stays on the row, so the sent-unchanged measure can tell answers from holding notes.
  const tier = TIERS.find((t) => t === held?.tier) ?? ((row.tags ?? '').split(' ').includes(NEEDS_ME) ? 'hold' : 'answer');
  const r = await sendReply(db, { ...c, dry_run: false }, { id, url: row.source_url, from, chat }, tier, draft, now, post);
  if (edited) db.prepare('UPDATE replies SET edited = 1 WHERE profile = ? AND id = ?').run(PROFILE, id);
  // The draft as the scan wrote it, kept for the corrections run.
  if (edited && row.draft && row.draft.trim() !== draft) db.prepare('UPDATE replies SET draft_text = ? WHERE profile = ? AND id = ? AND draft_text IS NULL').run(row.draft, PROFILE, id);
  if (r.status === 'sent' || r.status === 'answered') applyChanges(db, [{ table: 'items', id, profile: PROFILE, updated_at: Math.max(now, row.updated_at + 1), fields: { status: 'done', ...(text !== undefined ? { draft } : {}) } }]);
  return r;
}
