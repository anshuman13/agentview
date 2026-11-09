import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { channelIds, run, slackConfig } from './slack.js';
import { PROFILE, webUrl } from './slackSave.js';
import { applyChanges, type Change } from './sync.js';
import { DAY } from './time.js';

export const FAQ_PAGE = 'Support FAQ';
const MAX = 40;

const dateOf = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export type Faq = { question: string; answer: string; url: string; by: string; heading: string; at: string };

// The Support FAQ page, created as proposed when there is none yet.
function faqPage(db: Database, now: number) {
  const row = db.prepare("SELECT id FROM pages WHERE profile = ? AND deleted = 0 AND lower(title) = lower(?) AND COALESCE(state, 'live') != 'rejected'").get(PROFILE, FAQ_PAGE) as { id: string } | null;
  if (row) return row.id;
  const id = crypto.randomUUID();
  applyChanges(db, [{ table: 'pages', id, profile: PROFILE, updated_at: now, fields: { title: FAQ_PAGE, section: 'Support', summary: null, sort: now, state: 'proposed' } }]);
  return id;
}

// Saves each answered question as a proposed claim on the FAQ page, keyed by its permalink so a rerun adds nothing twice.
export function saveFaqs(db: Database, channel: string, faqs: Faq[], now = Date.now()) {
  const page = faqPage(db, now);
  const changes: Change[] = [];
  for (const f of faqs.slice(0, MAX)) {
    const url = webUrl(f.url);
    if (!url || !f.answer.trim()) continue;
    const id = `faq:${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
    if (db.prepare('SELECT 1 FROM facts WHERE profile = ? AND id = ?').get(PROFILE, id)) continue;
    const text = `${f.question.trim().replace(/\?*$/, '?')} ${f.answer.trim()}`.slice(0, 400);
    changes.push({
      table: 'facts', id, profile: PROFILE, updated_at: now,
      fields: { text, page_id: page, heading: f.heading.trim() || 'General', sources: JSON.stringify([{ kind: 'slack', label: `#${channel}, ${f.by}, ${f.at}`, url }]), at: now, state: 'proposed', replaces: null, added_by: `faq:${channel}` },
    });
  }
  return applyChanges(db, changes).applied;
}

// Reads a support channel's last days and proposes one FAQ claim per question that got a real answer there, for me to approve.
export async function mineFaq(db: Database, channel: string, days = 90, now = Date.now()) {
  const c = slackConfig();
  if (!c) throw new Error('Slack is not set up');
  const faqs: Faq[] = [];
  const save = tool('save_faq', 'Save one answered question for the FAQ.', {
    question: z.string().max(200).describe('The question as a colleague would ask it, one sentence'),
    answer: z.string().max(300).describe('The answer in one or two sentences, with the names, links, limits and steps it needs, as of its date'),
    url: z.string().describe('Permalink of the message that answered it'),
    by: z.string().describe('Who answered'),
    heading: z.string().max(40).describe('Topic, such as Access, Billing, Limits, Setup, Policy, Tools'),
    at: z.string().describe('Date of the answer, like 28 Oct 2026'),
  }, async (a) => {
    faqs.push(a);
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const since = now - days * DAY;
  const unix = Math.floor(since / 1000);
  const id = channelIds(db)[channel];
  const prompt = [
    `Read #${channel} ${id ?? '(find its id with slack_list_user_channels name_prefix)'} since ${dateOf(since)} with slack_read_channel oldest="${unix}" limit 40, following the next cursor until there is none. I am Slack user ${c.me}.`,
    'Find every question that got a real answer in its thread: open each thread that looks like a question with slack_read_thread. An answer counts when it settles the question with a fact, a step, a link, a limit or a decision; "I will look" does not.',
    `Call save_faq once per answered question, up to ${MAX}, newest first. When the same question was answered more than once, save the newest answer only. Say in the answer who or what is the source when it is not the thread itself.`,
    "Skip questions about one person's own data, anything with credentials or tokens, and anything still unresolved. Do not send or change anything in Slack. Do not use the em dash character. End with one line: how many threads you read and how many you saved.",
  ].join('\n');
  const result = await run(prompt, 'sonnet', [save], 80);
  return { result, found: faqs.length, saved: saveFaqs(db, channel, faqs, now) };
}
