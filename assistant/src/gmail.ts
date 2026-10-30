import type { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { pushNtfy } from '../../server/src/integrations/notify.js';
import { DB_DIR } from './db.js';
import { HUB_URL, run, webUrl } from './slack.js';
import { applyChanges, type Change } from './sync.js';
import { DAY, MIN, inWeekHours } from './time.js';

const EVERY = 30 * MIN;
const GMAIL = 'mcp__claude_ai_Gmail__';
const READ_TOOLS = ['search_threads', 'get_thread'].map((t) => GMAIL + t);
const PROFILE = 'work' as const;

// Kept outside the repo in ~/.agentview/assistant/gmail.json: my address, and the hours pushes may go out.
export type GmailConfig = { me: string; push?: { from: number; to: number } };

export function gmailConfig(file = path.join(DB_DIR, 'gmail.json')): GmailConfig | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof c?.me === 'string' && c.me.includes('@') ? c : null;
  } catch {
    return null;
  }
}

const Ask = z.object({
  thread_id: z.string().describe('The Gmail thread id'),
  url: z.string().optional().describe('The viewUrl of the thread, when the tool returned one'),
  from: z.string().describe('Who wrote, by name'),
  title: z.string().describe('Short imperative task for me'),
  quote: z.string().describe('The key sentence of the mail'),
  urgent: z.boolean().describe('True only if someone is blocked on me, there is a deadline today, or I was asked more than once'),
});
export type MailScan = { asks: z.infer<typeof Ask>[]; answered: string[] };

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
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: a.title.trim(), text: a.quote.trim(), source: 'gmail', source_url: link, people: a.from.trim(), at: null, status: 'suggested' } });
    added++;
    if (a.urgent) urgent.push({ ...a, id, link });
  }
  for (const thread of r.answered) {
    const old = has.get(PROFILE, mailId(thread)) as { status: string } | null;
    if (old && (old.status === 'suggested' || old.status === 'unassigned')) changes.push({ table: 'items', id: mailId(thread), profile: PROFILE, updated_at: now, fields: { status: 'done' } });
  }
  applyChanges(db, changes);
  return { added, urgent };
}

// Reads every half hour from 07:00 to 19:00 on weekdays; pushes only inside the configured hours.
export function mailDue(last: number, now = Date.now()) {
  return inWeekHours(now, 7, 19) && last < Math.floor(now / EVERY) * EVERY;
}

export function mailPushHours(c: GmailConfig, now = Date.now()) {
  const { from, to } = c.push ?? { from: 8, to: 17 };
  return inWeekHours(now, from, to);
}

const day = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};

// One Haiku pass over the inbox since the last pass. Read only: the prompt and the allowed tools never send or change mail.
export async function scanGmail(db: Database, c: GmailConfig, now = Date.now()) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'gmail:last'").get() as { value: string } | null;
  const since = Math.max(Number(row?.value ?? 0), now - 3 * DAY);
  const open = db.prepare("SELECT id, title, people FROM items WHERE profile = ? AND deleted = 0 AND source = 'gmail' AND status = 'suggested' AND updated_at > ?").all(PROFILE, now - 7 * DAY) as { id: string; title: string; people: string }[];
  let saved: MailScan | null = null;
  const save = tool('save_mail', 'Save what you found. Call once at the end.', { asks: z.array(Ask), answered: z.array(z.string()).describe('Thread ids from the open asks that I have replied to since') }, async (a) => {
    saved = a;
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const prompt = [
    `I am ${c.me}. Read what is new in my Gmail inbox since ${new Date(since).toISOString()}. Only read: never send, reply, draft, label, archive or trash anything.`,
    `1. search_threads with query "in:inbox after:${day(since)} -category:promotions -category:social -category:updates -category:forums", view THREAD_VIEW_SUMMARY, pageSize 30.`,
    ...(open.length ? [`2. search_threads with query "from:me after:${day(since)}", view THREAD_VIEW_IDS_ONLY, pageSize 50, to see which threads I replied to.`] : []),
    'Make these searches in parallel in one turn. Read a thread with get_thread, messageFormat PLAIN_TEXT, only when the summary is not enough to tell whether it asks something of me.',
    '',
    'Add an ask only when a person wrote to me and clearly asks me to do, answer, review or decide something, and the newest message in the thread is not from me.',
    'Skip newsletters, notifications, receipts, calendar invites and replies, mailing lists, and anything sent by a system or a no-reply address. Skip mail older than the time above and anything already in my open asks.',
    'Use the thread id, and the thread viewUrl when the tool returns one.',
    ...(open.length ? ['In answered, list thread ids of the open asks below that appear in my sent search.'] : []),
    '',
    'Open asks:',
    ...(open.length ? open.map((a) => `- ${a.id.slice('gmail:'.length)} ${a.people}: ${a.title}`) : ['(none)']),
    '',
    'Then call save_mail exactly once and stop. Do not use the em dash character.',
  ].join('\n');
  await run(prompt, 'haiku', [save], 30, () => saved != null, READ_TOOLS);
  if (!saved) throw new Error('Haiku did not save the mail scan');
  const r = saveMail(db, saved, now);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('gmail:last', ?)").run(String(now));
  return r;
}

async function pushUrgent(c: GmailConfig, urgent: Awaited<ReturnType<typeof scanGmail>>['urgent'], now = Date.now()) {
  if (!mailPushHours(c, now)) return;
  for (const a of urgent) {
    const accept = `http, Make task, ${HUB_URL}/gmail/accept?id=${encodeURIComponent(a.id)}, method=POST, clear=true`;
    await pushNtfy(`${a.from}: ${a.title}`, 'Gmail', a.quote, a.link, `view, Open, ${a.link}; ${accept}`).catch(() => false);
  }
}

export function startGmail(db: () => Database, every = MIN) {
  let busy = false;
  let tried = 0;
  const tick = async () => {
    const c = gmailConfig();
    if (busy || !c || !mailDue(tried)) return;
    busy = true;
    tried = Date.now();
    try {
      const r = await scanGmail(db(), c);
      console.log(`gmail: ${r.added} asks, ${r.urgent.length} urgent`);
      await pushUrgent(c, r.urgent);
    } catch (err) {
      console.error('gmail:', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(tick, every).unref();
}
