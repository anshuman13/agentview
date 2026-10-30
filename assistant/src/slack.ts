import type { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { pushNtfy } from '../../server/src/integrations/notify.js';
import { DB_DIR } from './db.js';
import { DRAFT_STEP, contextTool } from './draft.js';
import { ACCOUNT_OF } from './calendar.js';
import { ask } from './claude.js';
import { Ask, Chat, Decided, Detail, PROFILE, Said, askId, saveScan, webUrl, type ScanResult } from './slackSave.js';
import { applyChanges } from './sync.js';
import { DAY, MIN, inWeekHours, localDate } from './time.js';

const EVERY = 15 * MIN;
const SLACK = 'mcp__claude_ai_Slack__';
const READ_TOOLS = ['slack_search_public_and_private', 'slack_read_channel', 'slack_read_thread', 'slack_list_user_channels', 'slack_read_user_profile'].map((t) => SLACK + t);
export const HUB_URL = process.env.ASSISTANT_PUBLIC ?? 'http://macmini.netbird.cloud:7790';

// Kept outside the repo in ~/.agentview/assistant/slack.json: my Slack user id, the workspace domain and the channels to watch.
export type SlackConfig = { me: string; domain: string; channels: string[]; push?: { from: number; to: number } };

export function slackConfig(file = path.join(DB_DIR, 'slack.json')): SlackConfig | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof c?.me === 'string' && Array.isArray(c.channels) ? c : null;
  } catch {
    return null;
  }
}

// Reads happen every quarter hour from 07:00 to 19:00 on weekdays; pushes only inside the configured hours.
export function scanDue(last: number, now = Date.now()) {
  return inWeekHours(now, 7, 19) && last < Math.floor(now / EVERY) * EVERY;
}

export function pushHours(c: SlackConfig, now = Date.now()) {
  const { from, to } = c.push ?? { from: 8, to: 17 };
  return inWeekHours(now, from, to);
}

function sinceOf(db: Database, now: number) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'slack:last'").get() as { value: string } | null;
  return Math.max(Number(row?.value ?? 0), now - 3 * DAY);
}

export type Tools = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>;

// Stops as soon as done() says the work is saved, so the model does not spend turns repeating itself.
export async function run(prompt: string, model: 'haiku' | 'sonnet', tools: Tools, maxTurns: number, done = () => false, read = READ_TOOLS) {
  const account = ACCOUNT_OF[PROFILE];
  let result = '';
  for await (const m of ask(account, prompt, {
    model,
    maxTurns,
    cwd: os.tmpdir(),
    env: { ENABLE_TOOL_SEARCH: 'false' },
    ...(model === 'haiku' && { thinking: { type: 'disabled' as const } }),
    mcpServers: { codex: createSdkMcpServer({ name: 'codex', tools }) },
    allowedTools: [...read, ...tools.map((t) => `mcp__codex__${t.name}`)],
    permissionMode: 'dontAsk',
  })) {
    if (m.type === 'result') {
      if (m.subtype !== 'success') throw new Error(`Ended with ${m.subtype}`);
      result = m.result.trim();
    }
    if (m.type === 'user' && done()) break;
  }
  return result;
}

const openAsks = (db: Database, since: number) =>
  db.prepare("SELECT id, title, source_url, people FROM items WHERE profile = ? AND deleted = 0 AND source = 'slack' AND id NOT LIKE 'said:%' AND status IN ('suggested', 'open') AND updated_at > ?").all(PROFILE, since) as { id: string; title: string; source_url: string; people: string }[];
const tracked = (db: Database) =>
  db.prepare("SELECT id, title FROM items WHERE profile = ? AND deleted = 0 AND status IN ('open', 'suggested') AND COALESCE(source, '') NOT IN ('slack', 'calendar') ORDER BY updated_at DESC LIMIT 60").all(PROFILE) as { id: string; title: string }[];

const channelIds = (db: Database): Record<string, string> => {
  try {
    return JSON.parse((db.prepare("SELECT value FROM meta WHERE key = 'slack:channels'").get() as { value: string } | null)?.value ?? '{}');
  } catch {
    return {};
  }
};

// Channel ids found in a scan are kept, so later scans read the channels without looking them up.
function keepChannelIds(db: Database, c: SlackConfig, r: ScanResult) {
  const ids = channelIds(db);
  for (const x of r.channels ?? []) {
    const name = x.name.replace(/^#/, '');
    if (c.channels.includes(name) && /^C[A-Z0-9]+$/.test(x.id)) ids[name] = x.id;
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('slack:channels', ?)").run(JSON.stringify(ids));
}

// One Haiku pass over my DMs, mentions and watched channels since the last pass.
export async function scanSlack(db: Database, c: SlackConfig, now = Date.now()) {
  const since = sinceOf(db, now);
  const chats = db.prepare('SELECT id, name, summary FROM chats WHERE profile = ? AND deleted = 0').all(PROFILE) as { id: string; name: string; summary: string | null }[];
  let saved: ScanResult | null = null;
  const save = tool('save_scan', 'Save what you found. Call once at the end.', { chats: z.array(Chat), asks: z.array(Ask), answered: z.array(z.string()).describe('Permalinks from the open asks that I have since replied to or that are resolved'), details: z.array(Detail).describe('New details on the open asks or tracked tasks below'), said: z.array(Said).describe('Things I promised to do in my own messages'), decisions: z.array(Decided).describe('Decisions made in the watched channels'), channels: z.array(z.object({ name: z.string(), id: z.string() })).describe('Every watched channel you read, by name without # and id') }, async (a) => {
    saved = a;
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const unix = Math.floor(since / 1000);
  const ids = channelIds(db);
  const prompt = [
    `I am Slack user ${c.me}. Read what is new in Slack since unix time ${unix} (${new Date(since).toISOString()}). Do not send or change anything in Slack.`,
    `1. My DMs and group DMs: slack_search_public_and_private with filters "is:dm", after="${unix}", sort "timestamp", include_context false.`,
    `2. Mentions of me: slack_search_public_and_private with keywords ["<@${c.me}>"], after="${unix}", sort "timestamp", include_context false.`,
    `3. These channels, with slack_read_channel oldest="${unix}" limit 40: ${c.channels.map((n) => `#${n} ${ids[n] ?? '(id unknown, find it with slack_list_user_channels name_prefix)'}`).join(', ')}.`,
    'Make all of these reads in parallel in one turn. Read a thread with slack_read_thread only when a new message there might ask something of me.',
    '',
    `Permalinks look like https://${c.domain}/archives/<channel id>/p<ts without the dot>.`,
    'Only for DMs and channels with new messages, give an updated running summary, using the channel id. Leave out chats with no new messages and bot DMs. The previous summaries are below; keep what still matters and drop what is old.',
    'Add an ask only when a message clearly asks me to do, answer or decide something, and I have not replied after it. Skip FYIs, chatter, bots, and anything already in my open asks or tracked tasks below.',
    DRAFT_STEP,
    'In answered, list permalinks of the open asks below that I have replied to or that someone resolved.',
    `In said, add each new message of mine that commits me to do something ("I'll send it tomorrow", "will check and get back to you"). Skip promises I kept later in the same chat, and anything already in my tracked tasks. Today is ${localDate(now)}; set due only when I named a time.`,
    'In decisions, add each decision the new messages in the watched channels settle: a plan, owner, date, number or status the people there agreed on. Skip proposals, questions and chatter.',
    'In details, add a note when a new message gives more detail on one of the open asks or tracked tasks below: a date, a requirement, a link, a change of scope or who owns it. Use the id in brackets. Skip messages that only repeat the task.',
    '',
    'Previous summaries:',
    ...(chats.length ? chats.map((x) => `- ${x.id} ${x.name}: ${x.summary ?? ''}`) : ['(none)']),
    '',
    'Open asks:',
    ...openAsks(db, now - 7 * DAY).map((a) => `- [${a.id}] ${a.source_url} ${a.people}: ${a.title}`),
    '',
    'Tracked tasks:',
    ...tracked(db).map((t) => `- [${t.id}] ${t.title}`),
    '',
    'Then call save_scan exactly once and stop. Do not use the em dash character.',
  ].join('\n');
  await run(prompt, 'haiku', [save, contextTool(db, now)], 40, () => saved != null);
  if (!saved) throw new Error('Haiku did not save the scan');
  keepChannelIds(db, c, saved);
  const { added, urgent, said } = saveScan(db, saved, now);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('slack:last', ?)").run(String(now));
  return { chats: (saved as ScanResult).chats.length, asks: added, said, urgent };
}

async function pushUrgent(c: SlackConfig, urgent: Awaited<ReturnType<typeof scanSlack>>['urgent'], now = Date.now()) {
  if (!pushHours(c, now)) return;
  for (const a of urgent) {
    const url = webUrl(a.url);
    const accept = `http, Make task, ${HUB_URL}/slack/accept?id=${encodeURIComponent(a.id)}, method=POST, clear=true`;
    await pushNtfy(`${a.from}: ${a.title}`, a.chat, a.quote, url ?? '', url ? `view, Open, ${url}; ${accept}` : accept).catch(() => false);
  }
}

// The Sonnet summary across all chats since the last one, with suggested tasks. Runs when I ask for it.
export async function summarizeSlack(db: Database, now = Date.now()) {
  const c = slackConfig();
  if (!c) throw new Error('Slack is not set up: add ~/.agentview/assistant/slack.json');
  const last = db.prepare("SELECT MAX(to_at) AS t FROM briefs WHERE profile = ? AND deleted = 0 AND kind = 'slack'").get(PROFILE) as { t: number | null };
  const from = Math.max(last.t ?? 0, now - 3 * DAY);
  const chats = db.prepare('SELECT name, kind, summary, url FROM chats WHERE profile = ? AND deleted = 0 AND last_at > ? ORDER BY last_at DESC').all(PROFILE, from) as { name: string; kind: string; summary: string; url: string | null }[];
  const added: string[] = [];
  const suggest = tool('suggest_task', 'Suggest a task for me; it waits for me to accept it.', { title: z.string(), quote: z.string(), url: z.string().describe('Permalink'), from: z.string(), chat: z.string() }, async (a) => {
    const id = askId(a.url);
    if (!db.prepare('SELECT 1 FROM items WHERE profile = ? AND id = ?').get(PROFILE, id)) {
      applyChanges(db, [{ table: 'items', id, profile: PROFILE, updated_at: Date.now(), fields: { title: a.title.trim(), text: a.quote.trim(), source: 'slack', source_url: webUrl(a.url), people: `${a.from} · ${a.chat}`, at: null, status: 'suggested' } }]);
      added.push(a.title.trim());
    }
    return { content: [{ type: 'text', text: 'added' }] };
  });
  const prompt = [
    `Summarize my Slack since ${new Date(from).toISOString()}. I am Slack user ${c.me}. Do not send or change anything in Slack.`,
    'Below are running summaries per chat and my open asks. Read threads with the Slack tools when you need detail.',
    'Write markdown with these sections, skipping empty ones: **Needs you**, **Decided**, **Worth following**. Short bullets, each with a [link](permalink) and who.',
    'Call suggest_task for each thing I should do that is not already an open ask.',
    'Do not use the em dash character.',
    '',
    'Chats:',
    ...(chats.length ? chats.map((x) => `- ${x.name} (${x.kind}${x.url ? `, ${x.url}` : ''}): ${x.summary}`) : ['(nothing new)']),
    '',
    'Open asks:',
    ...openAsks(db, from).map((a) => `- ${a.source_url} ${a.people}: ${a.title}`),
  ].join('\n');
  const text = await run(prompt, 'sonnet', [suggest], 30);
  applyChanges(db, [{ table: 'briefs', id: `slack:${now}`, profile: PROFILE, updated_at: now, fields: { kind: 'slack', text, from_at: from, to_at: now } }]);
  return { text, added };
}

export function startSlack(db: () => Database, every = MIN) {
  let busy = false;
  let tried = 0;
  const tick = async () => {
    const c = slackConfig();
    if (busy || !c || !scanDue(tried)) return;
    busy = true;
    tried = Date.now();
    try {
      const r = await scanSlack(db(), c);
      console.log(`slack: ${r.chats} chats, ${r.asks} asks, ${r.said} promises, ${r.urgent.length} urgent`);
      await pushUrgent(c, r.urgent);
    } catch (err) {
      console.error('slack:', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(tick, every).unref();
}
