import type { Database } from 'bun:sqlite';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ACCOUNT_OF } from './calendar.js';
import { scanPaused } from './claude.js';
import { pushOrHold } from './hold.js';
import { readJsonSync } from '../../server/src/json.js';
import { DB_DIR } from './db.js';
import { DRAFT_DESC, DRAFT_STEP, contextTool } from './draft.js';
import { HUB_URL, pushHours, run } from './slack.js';
import { saidId, webUrl } from './slackSave.js';
import { loop } from './once.js';
import { applyChanges, type Change } from './sync.js';
import { DAY, MIN, addWorkdays, localDate, parseWhen, workSlotDue, ymd } from './time.js';

const EVERY = 30 * MIN;
const GMAIL = 'mcp__claude_ai_Gmail__';
const READ_TOOLS = ['search_threads', 'get_thread'].map((t) => GMAIL + t);
const PROFILE = 'work' as const;
// Local midnight of the day of t, or of a later day, in epoch seconds: Gmail reads after:/before: dates as midnight Pacific.
const dayStart = (t: number, days = 0) => Math.floor(new Date(t).setHours(24 * days, 0, 0, 0) / 1000);

// Kept outside the repo in ~/.agentview/assistant/gmail.json: my address, and the hours pushes may go out.
export type GmailConfig = { me: string; push?: { from: number; to: number } };

export function gmailConfig(file = path.join(DB_DIR, 'gmail.json')): GmailConfig | null {
  const c = readJsonSync<any>(file, null);
  return typeof c?.me === 'string' && c.me.includes('@') ? c : null;
}

const Ask = z.object({
  thread_id: z.string().describe('The Gmail thread id'),
  url: z.string().optional().describe('The viewUrl of the thread, when the tool returned one'),
  from: z.string().describe('Who wrote, by name'),
  title: z.string().describe('Short imperative task for me'),
  quote: z.string().describe('The key sentence of the mail'),
  urgent: z.boolean().describe('True only if someone is blocked on me, there is a deadline today, or I was asked more than once'),
  draft: z.string().optional().describe(DRAFT_DESC),
});
const Said = z.object({
  thread_id: z.string().describe('The Gmail thread id'),
  url: z.string().optional().describe('The viewUrl of the thread, when the tool returned one'),
  to: z.string().describe('Who I promised it to, by name'),
  title: z.string().describe('Short imperative task for me, like "Send Kim the draft"'),
  quote: z.string().describe('My sentence with the promise'),
  due: z.string().optional().describe('When I said it would be done, as YYYY-MM-DD or YYYY-MM-DDTHH:MM local time; leave out when I named no time'),
});
const Sent = z.object({
  thread_id: z.string().describe('The Gmail thread id'),
  url: z.string().optional().describe('The viewUrl of the thread, when the tool returned one'),
  to: z.string().describe('Who I asked, by name'),
  subject: z.string().describe('The subject of the thread'),
  sent_at: z.string().describe('When I sent my last message, as YYYY-MM-DDTHH:MM local time'),
});
export type MailScan = { asks: z.infer<typeof Ask>[]; answered: string[]; said?: z.infer<typeof Said>[]; waiting?: z.infer<typeof Sent>[]; replied?: string[] };
// A thread where I asked something and nobody has replied yet.
export type Unanswered = { thread: string; url: string; to: string; subject: string; sent_at: number };

const threadOk = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);
export const mailId = (thread: string) => `gmail:${thread}`;
export const threadUrl = (thread: string, url?: string) => webUrl(url) ?? `https://mail.google.com/mail/u/0/#all/${thread}`;

// Saves one scan: mail that needs me as items to review, and closes the ones I have since answered.
export function saveMail(db: Database, r: MailScan, now = Date.now()) {
  const has = db.prepare('SELECT status FROM items WHERE profile = ? AND id = ?');
  const changes: Change[] = [];
  const urgent: (MailScan['asks'][number] & { id: string; link: string })[] = [];
  let added = 0;
  for (const a of r.asks) {
    if (!threadOk(a.thread_id)) continue;
    const id = mailId(a.thread_id);
    if (has.get(PROFILE, id) || changes.some((c) => c.id === id)) continue;
    const link = threadUrl(a.thread_id, a.url);
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: a.title.trim(), text: a.quote.trim(), source: 'gmail', source_url: link, people: a.from.trim(), at: null, status: 'suggested', draft: a.draft?.trim() || null } });
    added++;
    if (a.urgent) urgent.push({ ...a, id, link });
  }
  let said = 0;
  for (const p of r.said ?? []) {
    if (!threadOk(p.thread_id)) continue;
    const id = saidId(mailId(p.thread_id));
    if (has.get(PROFILE, id) || changes.some((c) => c.id === id)) continue;
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: p.title.trim(), text: p.quote.trim(), source: 'gmail', source_url: threadUrl(p.thread_id, p.url), people: p.to.trim(), at: parseWhen(p.due), status: 'suggested' } });
    said++;
  }
  for (const thread of r.answered) {
    const old = has.get(PROFILE, mailId(thread)) as { status: string } | null;
    if (old && (old.status === 'suggested' || old.status === 'unassigned')) changes.push({ table: 'items', id: mailId(thread), profile: PROFILE, updated_at: now, fields: { status: 'done' } });
  }
  applyChanges(db, changes);
  return { added, urgent, said };
}

export const WAIT_WORKDAYS = 3;
const WAIT_MAX = 14 * DAY;
const WAITING_ID = 'gmail:waiting';

export function unanswered(db: Database): Unanswered[] {
  const row = db.prepare('SELECT text FROM briefs WHERE profile = ? AND id = ? AND deleted = 0').get(PROFILE, WAITING_ID) as { text: string | null } | null;
  try {
    const list = JSON.parse(row?.text ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Keeps my sent questions with no reply after three workdays in one brief row, dropping them on a reply or after 14 days.
export function saveWaiting(db: Database, found: z.infer<typeof Sent>[], replied: string[], now = Date.now()) {
  const old = unanswered(db);
  const list = new Map(old.map((w) => [w.thread, w]));
  for (const f of found) {
    const sent = parseWhen(f.sent_at);
    if (!threadOk(f.thread_id) || sent == null) continue;
    list.set(f.thread_id, { thread: f.thread_id, url: threadUrl(f.thread_id, f.url), to: f.to.trim(), subject: f.subject.trim(), sent_at: list.get(f.thread_id)?.sent_at ?? sent });
  }
  const gone = new Set(replied);
  const keep = [...list.values()].filter((w) => !gone.has(w.thread) && now - w.sent_at <= WAIT_MAX && addWorkdays(w.sent_at, WAIT_WORKDAYS) <= now).sort((a, b) => a.sent_at - b.sent_at);
  if (JSON.stringify(keep) !== JSON.stringify(old)) applyChanges(db, [{ table: 'briefs', id: WAITING_ID, profile: PROFILE, updated_at: now, fields: { kind: 'waiting', text: JSON.stringify(keep), from_at: null, to_at: now } }]);
  return keep;
}

// One Haiku pass over the inbox since the last pass. Read only: the prompt and the allowed tools never send or change mail.
export async function scanGmail(db: Database, c: GmailConfig, now = Date.now()) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'gmail:last'").get() as { value: string } | null;
  const since = Math.max(Number(row?.value ?? 0), now - 3 * DAY);
  const open = db.prepare("SELECT id, title, people FROM items WHERE profile = ? AND deleted = 0 AND source = 'gmail' AND id NOT LIKE 'said:%' AND status = 'suggested' AND updated_at > ?").all(PROFILE, now - 7 * DAY) as { id: string; title: string; people: string }[];
  const waiting = unanswered(db);
  const checked = (db.prepare("SELECT value FROM meta WHERE key = 'gmail:waiting'").get() as { value: string } | null)?.value;
  const daily = checked !== ymd(now, '/');
  const unix = Math.floor(since / 1000);
  let saved: MailScan | null = null;
  const save = tool('save_mail', 'Save what you found. Call once at the end.', {
    asks: z.array(Ask),
    answered: z.array(z.string()).describe('Thread ids from the open asks that I have replied to since'),
    said: z.array(Said).describe('Things I promised to do in my own mail'),
    waiting: z.array(Sent).describe('Threads from the unanswered search where I asked something and nobody replied'),
    replied: z.array(z.string()).describe('Thread ids from my waiting list that someone has replied to'),
  }, async (a) => {
    saved = a;
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const prompt = [
    `I am ${c.me}. Read what is new in my Gmail inbox since ${new Date(since).toISOString()}. Only read: never send, reply, draft, label, archive or trash anything.`,
    `1. search_threads with query "in:inbox after:${unix} -category:promotions -category:social -category:updates -category:forums", view THREAD_VIEW_SUMMARY, pageSize 30.`,
    `2. search_threads with query "from:me after:${unix}", view THREAD_VIEW_SUMMARY, pageSize 30, to see what I wrote and which threads I replied to.`,
    ...(daily ? [`3. search_threads with query "from:me after:${dayStart(now - 14 * DAY)} before:${dayStart(addWorkdays(now, -WAIT_WORKDAYS), 1)}", view THREAD_VIEW_SUMMARY, pageSize 50, for unanswered mail.`] : []),
    'Make these searches in parallel in one turn. Read a thread with get_thread, messageFormat PLAIN_TEXT, only when the summary is not enough to tell whether it asks something of me or what I promised.',
    '',
    'Add an ask only when a person wrote to me and clearly asks me to do, answer, review or decide something, and the newest message in the thread is not from me.',
    'Skip newsletters, notifications, receipts, calendar invites and replies, mailing lists, and anything sent by a system or a no-reply address. Skip mail older than the time above and anything already in my open asks.',
    'Use the thread id, and the thread viewUrl when the tool returns one.',
    DRAFT_STEP,
    ...(open.length ? ['In answered, list thread ids of the open asks below that appear in my sent search.'] : []),
    `In said, add each new mail of mine that commits me to do something ("I'll send it tomorrow", "will get back to you"). Skip promises I kept later in the same thread. Today is ${localDate(now)}; set due only when I named a time.`,
    ...(daily ? ['In waiting, add threads from the unanswered search where the newest message is mine, it asks a person a question or for something, and nobody has replied since. Skip mail to systems, mailing lists and calendar replies.'] : []),
    ...(waiting.length ? ['In replied, list thread ids from my waiting list below that have a newer message from someone else in any search.'] : []),
    '',
    'Open asks:',
    ...(open.length ? open.map((a) => `- ${a.id.slice('gmail:'.length)} ${a.people}: ${a.title}`) : ['(none)']),
    '',
    ...(waiting.length ? ['My waiting list:', ...waiting.map((w) => `- ${w.thread} ${w.to}: ${w.subject}`), ''] : []),
    'Then call save_mail exactly once and stop. Do not use the em dash character.',
  ].join('\n');
  await run(prompt, 'haiku', [save, contextTool(db, now)], 30, () => saved != null, READ_TOOLS);
  if (!saved) throw new Error('Haiku did not save the mail scan');
  const r = saveMail(db, saved, now);
  const left = saveWaiting(db, (saved as MailScan).waiting ?? [], (saved as MailScan).replied ?? [], now);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('gmail:last', ?)").run(String(now));
  if (daily) db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('gmail:waiting', ?)").run(ymd(now, '/'));
  return { ...r, waiting: left.length };
}

async function pushUrgent(db: Database, c: GmailConfig, urgent: Awaited<ReturnType<typeof scanGmail>>['urgent'], now = Date.now()) {
  if (!pushHours(c, now)) return;
  for (const a of urgent) {
    const accept = `http, Make task, ${HUB_URL}/gmail/accept?id=${encodeURIComponent(a.id)}, method=POST, clear=true`;
    await pushOrHold(db, `${a.from}: ${a.title}`, 'Gmail', a.quote, a.link, `view, Open, ${a.link}; ${accept}`, now).catch(() => false);
  }
}

// Reads every half hour from 07:00 to 19:00 on weekdays; pushes only inside the configured hours.
export function startGmail(db: () => Database, every = MIN) {
  let tried = 0;
  loop('gmail', every, async () => {
    const c = gmailConfig();
    if (!c || !workSlotDue(tried, EVERY, Date.now()) || (await scanPaused(db(), ACCOUNT_OF[PROFILE], 'gmail'))) return;
    tried = Date.now();
    const r = await scanGmail(db(), c);
    console.log(`gmail: ${r.added} asks, ${r.said} promises, ${r.waiting} waiting, ${r.urgent.length} urgent`);
    await pushUrgent(db(), c, r.urgent);
  }, true);
}
