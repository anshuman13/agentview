import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DRAFT_DESC, liveClaims } from './draft.js';

// Tag on an ask the bot should not answer for me: it needs my decision or is urgent.
export const NEEDS_ME = 'needs-you';
export const needsMe = (tier?: string | null) => tier === 'hold' || tier === 'escalate';
const FAQ_TAG = 'faq';
const SURE = 0.8;
// A tier answer the draft rests on a live wiki claim with high confidence: an FAQ answer I can send without reading.
const sureAnswer = (db: Database, a: { tier?: string | null; confidence?: number | null; claims?: string[] | null }) =>
  a.tier === 'answer' && (a.confidence ?? 0) >= SURE && liveClaims(db, a.claims ?? []).length > 0;
// Access and limit asks are tagged so the apps can batch them: I grant those in one sitting in an admin console.
const ADMIN_KINDS = ['access', 'limit'] as const;
export const askTags = (db: Database, a: { tier?: string | null; confidence?: number | null; claims?: string[] | null; kind?: string | null }) =>
  [needsMe(a.tier) ? NEEDS_ME : '', sureAnswer(db, a) ? FAQ_TAG : '', ADMIN_KINDS.find((k) => k === a.kind) ?? ''].filter(Boolean).join(' ') || null;
import { applyChanges, type Change } from '../core/sync.js';
import { DAY, parseWhen } from '../core/time.js';

export const PROFILE = 'work' as const;
const REPLIED = 'Replied in Slack';

export const Chat = z.object({
  id: z.string().describe('Slack channel or DM id, like C0123 or D0123'),
  name: z.string().describe('#channel-name, or the other person for a DM'),
  kind: z.enum(['dm', 'channel', 'mention']),
  url: z.string().optional().describe('Permalink to the newest message'),
  summary: z.string().describe('The updated running summary: what is going on, who waits on me, what was decided. At most 3 short sentences.'),
  new_messages: z.number().describe('How many new messages you read in this chat since the last pass'),
  waiting: z.boolean().optional().describe('DMs only: true when the other person sent the last message and I have not replied'),
});
export const Ask = z.object({
  url: z.string().describe('Permalink of the message'),
  from: z.string().describe('Who asked'),
  from_id: z.string().optional().describe('Slack user id of who asked, like U0123ABC'),
  chat: z.string().describe('#channel-name, or "DM" for a direct message; never an id'),
  title: z.string().describe('Short imperative task for me'),
  quote: z.string().describe('The key sentence of the message'),
  urgent: z.boolean().describe('True only if someone is blocked on me, there is a deadline today, an incident, or I was pinged more than once'),
  draft: z.string().optional().describe(DRAFT_DESC),
  tier: z.enum(['answer', 'hold', 'escalate']).optional().describe('answer: the thread or ask_context fully answers it as a fact. hold: it needs my decision, approval, review, estimate, opinion, access I grant, or a meeting. escalate: an incident or outage, anything urgent, HR or legal, my manager or a listed person, or someone outside the company.'),
  confidence: z.number().min(0).max(1).optional().describe('How sure you are that the draft is correct and complete, 0 to 1'),
  why: z.string().optional().describe('One line on the tier and confidence'),
  answered_by_other: z.boolean().optional().describe('True when someone other than me already answered it in the thread'),
  claims: z.array(z.string()).optional().describe('Ids of the wiki claims from ask_context the draft rests on'),
  external: z.boolean().optional().describe('True when the channel is shared with another company (Slack Connect) or who asked is a guest or outside the company'),
  kind: z.enum(['access', 'limit', 'other']).optional().describe('access: they want an invite, seat, account, plan move, connector or permission that I grant. limit: they want a higher usage or spend limit. other: anything else.'),
});
// A commitment I made myself, like "I'll send it tomorrow".
export const Said = z.object({
  url: z.string().describe('Permalink of my message'),
  to: z.string().describe('Who I promised it to'),
  chat: z.string().describe('#channel-name, or "DM" for a direct message; never an id'),
  title: z.string().describe('Short imperative task for me, like "Send Kim the draft"'),
  quote: z.string().describe('My sentence with the promise'),
  due: z.string().optional().describe('When I said it would be done, as YYYY-MM-DD or YYYY-MM-DDTHH:MM local time; leave out when I named no time'),
});
export const Detail = z.object({
  id: z.string().describe('The id in brackets of the open ask or tracked task'),
  note: z.string().describe('The new detail in one sentence: a date, a requirement, a link, a change of scope or who owns it'),
  from: z.string().describe('Who said it'),
  url: z.string().describe('Permalink of the message'),
});
export const Decided = z.object({
  text: z.string().describe('What was decided, in one short line'),
  channel: z.string().describe('#channel-name; never an id'),
  url: z.string().describe('Permalink of the message with the decision'),
  time: z.string().describe('When it was decided, as YYYY-MM-DDTHH:MM local time'),
});
export type ScanResult = { chats: (Omit<z.infer<typeof Chat>, 'new_messages'> & { new_messages?: number })[]; asks: z.infer<typeof Ask>[]; answered: string[]; fulfilled?: string[]; details?: z.infer<typeof Detail>[]; said?: z.infer<typeof Said>[]; decisions?: z.infer<typeof Decided>[]; channels?: { name: string; id: string }[]; commands?: { text: string; url: string }[] };

// Permalinks come from the model, so only web links are stored or pushed; no comma or semicolon, which split ntfy actions.
export const webUrl = (u: string | null | undefined) => (u && /^https?:\/\/[^\s,;]+$/i.test(u) ? u : null);

// The thread a permalink belongs to: channel and thread_ts when it is a reply, else the message itself.
export function threadKey(url: string) {
  try {
    const u = new URL(url);
    const ts = u.searchParams.get('thread_ts');
    const parts = u.pathname.split('/');
    const channel = parts[parts.indexOf('archives') + 1] ?? '';
    const last = parts[parts.length - 1] ?? '';
    const m = /^p(\d{10})(\d{6})$/.exec(last);
    return `${channel}/${ts ?? (m ? `${m[1]}.${m[2]}` : last)}`;
  } catch {
    return url;
  }
}

export const askId = (url: string) => `slack:${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
// My own promises keep the id of their source with this prefix, so the apps label them "You said".
export const saidId = (id: string) => `said:${id}`;

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'with', 'about', 'from', 'this', 'that', 'into', 'our', 'are', 'can', 'will', 'not', 'all', 'her', 'his', 'him', 'them', 'they', 'its']);
const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));
// Two titles for the same thing: at least two words in common, and most words of the shorter one are in the other.
function sameAsk(a: string, b: string) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n >= 2 && n / Math.min(x.size, y.size) >= 0.6;
}

// Items of one source from the last week in any state, and older ones still to review, so an ask or promise already seen, done
// or dismissed is not added again from another message. An ask is only matched with asks, and a promise of mine with promises.
export function seenItems(db: Database, source: 'slack' | 'gmail', now: number) {
  const seen = db.prepare("SELECT id, title, people FROM items WHERE profile = ? AND source = ? AND (updated_at > ? OR (deleted = 0 AND status = 'suggested'))").all(PROFILE, source, now - 7 * DAY) as { id: string; title: string | null; people: string | null }[];
  const key = (p: string | null) => (p ?? '').trim().toLowerCase();
  return {
    known: (id: string, title: string, people: string) => seen.some((x) => x.id.startsWith('said:') === id.startsWith('said:') && key(x.people) === key(people) && sameAsk(x.title ?? '', title)),
    add: (id: string, title: string, people: string) => void seen.push({ id, title, people }),
  };
}

// Suggestions of one source nobody reviewed within a week are dismissed, but not tasks rollover sent back for review; their ids stay, so the same message is not added again.
export function expireSuggested(db: Database, source: 'slack' | 'gmail', now: number): Change[] {
  const rows = db.prepare("SELECT id FROM items WHERE profile = ? AND deleted = 0 AND status = 'suggested' AND COALESCE(rolls, 0) = 0 AND source = ? AND updated_at < ?").all(PROFILE, source, now - 7 * DAY) as { id: string }[];
  return rows.map((r) => ({ table: 'items', id: r.id, profile: PROFILE, updated_at: now, fields: { status: 'dismissed' } }));
}

// A DM still waiting on me after 3 days without a new message was settled elsewhere (a reaction, a call, another chat); a scan never rereads it.
export function expireWaiting(db: Database, now: number): Change[] {
  const rows = db.prepare("SELECT id FROM chats WHERE profile = ? AND deleted = 0 AND kind = 'dm' AND waiting = 1 AND last_at < ?").all(PROFILE, now - 3 * DAY) as { id: string }[];
  return rows.map((r) => ({ table: 'chats', id: r.id, profile: PROFILE, updated_at: now, fields: { waiting: 0 } }));
}

type Asked = ScanResult['asks'][number] & { id: string };
type Has = { get(...args: [string, string]): unknown };

const statusOf = (has: Has, id: string) => has.get(PROFILE, id) as { status: string } | null;
const done = (id: string, now: number): Change => ({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { status: 'done' } });

// A chat with nothing new keeps its running summary; one without an id is dropped.
function chatChanges(r: ScanResult, now: number): Change[] {
  return r.chats.filter((c) => c.new_messages !== 0 && c.id.trim()).map((c) => ({ table: 'chats', id: c.id, profile: PROFILE, updated_at: now, fields: { name: c.name, kind: c.kind, url: webUrl(c.url), summary: c.summary.trim(), last_at: now, waiting: c.kind === 'dm' ? (c.waiting ? 1 : 0) : null } }));
}

// Asks not saved, answered or replied to yet become suggested items; the urgent ones are listed apart.
function askChanges(db: Database, r: ScanResult, seen: ReturnType<typeof seenItems>, has: Has, changes: Change[], now: number) {
  const urgent: Asked[] = [];
  const newAsks: Asked[] = [];
  // A DM where I sent the last message has nothing waiting on me.
  const replied = (a: ScanResult['asks'][number]) => a.chat === 'DM' && r.chats.some((c) => c.kind === 'dm' && c.waiting === false && c.name.trim().toLowerCase() === a.from.trim().toLowerCase());
  const answeredIds = new Set(r.answered.map(askId));
  for (const a of r.asks) {
    const id = askId(a.url);
    const people = `${a.from} · ${a.chat}`;
    if (answeredIds.has(id) || a.answered_by_other || has.get(PROFILE, id) || changes.some((c) => c.id === id) || seen.known(id, a.title, people) || replied(a)) continue;
    seen.add(id, a.title, people);
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: a.title.trim(), text: a.quote.trim(), source: 'slack', source_url: webUrl(a.url), people, at: null, status: 'suggested', draft: a.draft?.trim() || null, tags: askTags(db, a) } });
    newAsks.push({ ...a, id });
    if (a.urgent) urgent.push({ ...a, id });
  }
  return { urgent, newAsks };
}

function saidChanges(r: ScanResult, seen: ReturnType<typeof seenItems>, has: Has, changes: Change[], now: number) {
  let said = 0;
  for (const p of r.said ?? []) {
    // A promise without a usable permalink is told apart by its sentence.
    const id = saidId(askId(webUrl(p.url) ?? `${p.url}\n${p.quote.trim()}`));
    const people = `${p.to} · ${p.chat}`;
    if (has.get(PROFILE, id) || changes.some((c) => c.id === id) || seen.known(id, p.title, people)) continue;
    seen.add(id, p.title, people);
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: p.title.trim(), text: p.quote.trim(), source: 'slack', source_url: webUrl(p.url), people, at: parseWhen(p.due), status: 'suggested' } });
    said++;
  }
  return said;
}

// Closes asks answered in Slack and the suggestions of a DM I replied in; returns the accepted asks I answered, which stay open.
function closeAnswered(db: Database, r: ScanResult, has: Has, changes: Change[], now: number) {
  const answeredOpen: string[] = [];
  for (const url of r.answered) {
    const id = askId(url);
    const old = statusOf(has, id);
    if (old && (old.status === 'suggested' || old.status === 'unassigned')) changes.push(done(id, now));
    else if (old?.status === 'open') answeredOpen.push(id);
  }
  const repliedDms = new Set(r.chats.filter((c) => c.kind === 'dm' && c.waiting === false).map((c) => `${c.name.trim()} · DM`.toLowerCase()));
  if (repliedDms.size) {
    const stored = db.prepare("SELECT id, people FROM items WHERE profile = ? AND source = 'slack' AND status = 'suggested' AND deleted = 0 AND COALESCE(rolls, 0) = 0 AND id NOT LIKE 'said:%'").all(PROFILE) as { id: string; people: string | null }[];
    for (const o of stored) if (repliedDms.has((o.people ?? '').trim().toLowerCase()) && !changes.some((c) => c.id === o.id)) changes.push(done(o.id, now));
  }
  return answeredOpen;
}

function closeFulfilled(r: ScanResult, has: Has, changes: Change[], now: number) {
  for (const url of r.fulfilled ?? []) {
    const id = saidId(askId(webUrl(url) ?? url));
    const old = statusOf(has, id);
    if (old && (old.status === 'suggested' || old.status === 'open')) changes.push(done(id, now));
  }
}

// New details from Slack go at the end of the task's notes, once per message; an ask I accepted and then answered in Slack stays open, with one note.
function noteChanges(db: Database, r: ScanResult, answeredOpen: string[], now: number): Change[] {
  const task = db.prepare("SELECT text FROM items WHERE profile = ? AND id = ? AND deleted = 0 AND status IN ('open', 'suggested')");
  const texts = new Map<string, string>();
  for (const d of r.details ?? []) {
    const row = task.get(PROFILE, d.id) as { text: string | null } | null;
    if (!row) continue;
    const text = texts.get(d.id) ?? row.text ?? '';
    if (text.includes(d.url)) continue;
    texts.set(d.id, `${text ? `${text}\n\n` : ''}${d.from} on Slack: ${d.note.trim()} ${d.url}`);
  }
  const slackOpen = db.prepare("SELECT text FROM items WHERE profile = ? AND id = ? AND deleted = 0 AND status = 'open' AND source = 'slack'");
  for (const id of answeredOpen) {
    const row = slackOpen.get(PROFILE, id) as { text: string | null } | null;
    const text = texts.get(id) ?? row?.text ?? '';
    if (row && !text.split('\n').includes(REPLIED)) texts.set(id, `${text ? `${text}\n\n` : ''}${REPLIED}`);
  }
  return [...texts].map(([id, text]) => ({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { text } }));
}

// Saves one scan: chat summaries, asks and my promises as items to review, new details on tasks and channel decisions, and
// closes asks I have replied to. Returns how many chats had new messages and how many messages were read, how many asks and promises are new and which asks are urgent.
export function saveScan(db: Database, r: ScanResult, now = Date.now()) {
  const has = db.prepare('SELECT status FROM items WHERE profile = ? AND id = ?');
  const chats = chatChanges(r, now);
  const changes: Change[] = [...expireSuggested(db, 'slack', now), ...expireWaiting(db, now).filter((w) => !chats.some((c) => c.id === w.id)), ...chats];
  const messages = chats.reduce((n, c) => n + (r.chats.find((x) => x.id === c.id)?.new_messages ?? 0), 0);
  const seen = seenItems(db, 'slack', now);
  const { urgent, newAsks } = askChanges(db, r, seen, has, changes, now);
  const said = saidChanges(r, seen, has, changes, now);
  const answeredOpen = closeAnswered(db, r, has, changes, now);
  closeFulfilled(r, has, changes, now);
  changes.push(...noteChanges(db, r, answeredOpen, now));
  db.transaction(() => {
    applyChanges(db, changes);
    saveDecisions(db, r.decisions ?? [], now);
  })();
  return { chats: chats.length, added: newAsks.length, urgent, said, messages, newAsks };
}

// Channel decisions with a web permalink are kept once per permalink for wiki updates, so a re-worded one is not looked at again; ones older than two weeks are dropped.
function saveDecisions(db: Database, list: z.infer<typeof Decided>[], now: number) {
  db.prepare('DELETE FROM slack_decisions WHERE at < ?').run(now - 14 * DAY);
  const seen = db.prepare('SELECT 1 FROM slack_decisions WHERE profile = ? AND url = ?');
  const add = db.prepare('INSERT OR IGNORE INTO slack_decisions (profile, id, text, channel, url, at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const d of list) {
    const url = webUrl(d.url);
    const text = d.text.trim();
    const name = d.channel.trim().replace(/^#/, '');
    if (!url || !text || !name || seen.get(PROFILE, url)) continue;
    add.run(PROFILE, createHash('sha1').update(`${url}\n${text.toLowerCase()}`).digest('hex').slice(0, 16), text, `#${name}`, url, Math.min(parseWhen(d.time) ?? now, now));
  }
}

// Skip pressed on a push or in the app: the ask closes with no reply and its draft is dropped.
export function skipAsk(db: Database, id: string, reason = '', now = Date.now()) {
  const row = db.prepare("SELECT draft FROM items WHERE profile = ? AND id = ? AND source = 'slack' AND deleted = 0").get(PROFILE, id) as { draft: string | null } | null;
  if (!row) return false;
  applyChanges(db, [{ table: 'items', id, profile: PROFILE, updated_at: now, fields: { status: 'done', draft: null } }]);
  db.prepare("UPDATE replies SET status = 'skipped', why = 'skipped', draft_text = ?, skip_reason = ? WHERE profile = ? AND id = ? AND status IN ('held', 'error')").run(row.draft?.trim() || null, reason.trim() || null, PROFILE, id);
  return true;
}

export function acceptAsk(db: Database, id: string, source: 'slack' | 'gmail' = 'slack', now = Date.now()) {
  const row = db.prepare('SELECT 1 FROM items WHERE profile = ? AND id = ? AND source = ? AND deleted = 0').get(PROFILE, id, source);
  if (!row) return false;
  applyChanges(db, [{ table: 'items', id, profile: PROFILE, updated_at: now, fields: { status: 'open' } }]);
  return true;
}
