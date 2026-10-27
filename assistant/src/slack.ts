import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir, isLimited, markLimited, overageUntil } from '../../server/src/agent/claude/accounts.js';
import { pushNtfy } from '../../server/src/integrations/notify.js';
import { DB_DIR } from './db.js';
import { PROFILES } from './calendar.js';
import { applyChanges, type Change } from './sync.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const EVERY = 15 * MIN;
const SLACK = 'mcp__claude_ai_Slack__';
const READ_TOOLS = ['slack_search_public_and_private', 'slack_read_channel', 'slack_read_thread', 'slack_list_user_channels', 'slack_read_user_profile'].map((t) => SLACK + t);
const PROFILE = 'work' as const;
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

const Chat = z.object({
  id: z.string().describe('Slack channel or DM id, like C0123 or D0123'),
  name: z.string().describe('#channel-name, or the other person for a DM'),
  kind: z.enum(['dm', 'channel', 'mention']),
  url: z.string().optional().describe('Permalink to the newest message'),
  summary: z.string().describe('The updated running summary: what is going on, who waits on me, what was decided. At most 3 short sentences.'),
});
const Ask = z.object({
  url: z.string().describe('Permalink of the message'),
  from: z.string().describe('Who asked'),
  chat: z.string().describe('#channel or DM'),
  title: z.string().describe('Short imperative task for me'),
  quote: z.string().describe('The key sentence of the message'),
  urgent: z.boolean().describe('True only if someone is blocked on me, there is a deadline today, an incident, or I was pinged more than once'),
});
export type ScanResult = { chats: z.infer<typeof Chat>[]; asks: z.infer<typeof Ask>[]; answered: string[] };

export const askId = (url: string) => `slack:${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;

// Saves one scan: chat summaries, asks as items to review, and closes asks I have replied to. Returns the new urgent asks.
export function saveScan(db: Database, r: ScanResult, now = Date.now()) {
  const has = db.prepare('SELECT status FROM items WHERE profile = ? AND id = ?');
  const changes: Change[] = r.chats.map((c) => ({ table: 'chats', id: c.id, profile: PROFILE, updated_at: now, fields: { name: c.name, kind: c.kind, url: c.url ?? null, summary: c.summary.trim(), last_at: now } }));
  const urgent: (ScanResult['asks'][number] & { id: string })[] = [];
  for (const a of r.asks) {
    const id = askId(a.url);
    if (has.get(PROFILE, id)) continue;
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: a.title.trim(), text: a.quote.trim(), source: 'slack', source_url: a.url, people: `${a.from} · ${a.chat}`, at: null, status: 'suggested' } });
    if (a.urgent) urgent.push({ ...a, id });
  }
  for (const url of r.answered) {
    const id = askId(url);
    const old = has.get(PROFILE, id) as { status: string } | null;
    if (old && (old.status === 'suggested' || old.status === 'unassigned')) changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { status: 'done' } });
  }
  applyChanges(db, changes);
  return urgent;
}

// Reads happen every quarter hour from 07:00 to 19:00 on weekdays; pushes only inside the configured hours.
export function scanDue(last: number, now = Date.now()) {
  const d = new Date(now);
  return d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 7 && d.getHours() < 19 && last < Math.floor(now / EVERY) * EVERY;
}

export function pushHours(c: SlackConfig, now = Date.now()) {
  const d = new Date(now);
  const { from, to } = c.push ?? { from: 8, to: 17 };
  return d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= from && d.getHours() < to;
}

function sinceOf(db: Database, now: number) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'slack:last'").get() as { value: string } | null;
  return Math.max(Number(row?.value ?? 0), now - 3 * DAY);
}

type Tools = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>;

async function run(prompt: string, model: 'haiku' | 'sonnet', tools: Tools, maxTurns: number) {
  const account = PROFILES[PROFILE];
  if (isLimited(account)) throw new Error('The Claude account is at its usage limit');
  const dir = configDir(account);
  let result = '';
  for await (const m of query({
    prompt,
    options: {
      persistSession: false,
      model,
      maxTurns,
      cwd: os.tmpdir(),
      settingSources: [],
      env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      mcpServers: { codex: createSdkMcpServer({ name: 'codex', tools }) },
      allowedTools: [...READ_TOOLS, ...tools.map((t) => `mcp__codex__${t.name}`)],
      permissionMode: 'dontAsk',
    },
  })) {
    const until = overageUntil(m);
    if (until) {
      markLimited(account, until);
      throw new Error('Stopped before using extra usage');
    }
    if (m.type === 'result') {
      if (m.subtype !== 'success') throw new Error(`Ended with ${m.subtype}`);
      result = m.result.trim();
    }
  }
  return result;
}

const openAsks = (db: Database, since: number) =>
  db.prepare("SELECT title, source_url, people FROM items WHERE profile = ? AND deleted = 0 AND source = 'slack' AND status IN ('suggested', 'open') AND updated_at > ?").all(PROFILE, since) as { title: string; source_url: string; people: string }[];

// One Haiku pass over my DMs, mentions and watched channels since the last pass.
export async function scanSlack(db: Database, c: SlackConfig, now = Date.now()) {
  const since = sinceOf(db, now);
  const chats = db.prepare('SELECT id, name, summary FROM chats WHERE profile = ? AND deleted = 0').all(PROFILE) as { id: string; name: string; summary: string | null }[];
  let saved: ScanResult | null = null;
  const save = tool('save_scan', 'Save what you found. Call once at the end.', { chats: z.array(Chat), asks: z.array(Ask), answered: z.array(z.string()).describe('Permalinks from the open asks that I have since replied to or that are resolved') }, async (a) => {
    saved = a;
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const unix = Math.floor(since / 1000);
  const prompt = [
    `I am Slack user ${c.me}. Read what is new in Slack since unix time ${unix} (${new Date(since).toISOString()}). Do not send or change anything in Slack.`,
    `1. My DMs and group DMs: slack_search_public_and_private with filters "is:dm", after="${unix}", sort "timestamp", include_context false.`,
    `2. Mentions of me: slack_search_public_and_private with filters "<@${c.me}>", after="${unix}", sort "timestamp", include_context false.`,
    `3. These channels, with slack_read_channel oldest="${unix}" limit 40 (find ids with slack_list_user_channels name_prefix): ${c.channels.map((n) => `#${n}`).join(', ')}.`,
    'Read a thread with slack_read_thread only when a new message there might ask something of me.',
    '',
    `Permalinks look like https://${c.domain}/archives/<channel id>/p<ts without the dot>.`,
    'For each DM or channel with new messages, give an updated running summary. The previous summaries are below; keep what still matters and drop what is old.',
    'Add an ask only when a message clearly asks me to do, answer or decide something, and I have not replied after it. Skip FYIs, chatter and bots.',
    'In answered, list permalinks of the open asks below that I have replied to or that someone resolved.',
    '',
    'Previous summaries:',
    ...(chats.length ? chats.map((x) => `- ${x.id} ${x.name}: ${x.summary ?? ''}`) : ['(none)']),
    '',
    'Open asks:',
    ...openAsks(db, now - 7 * DAY).map((a) => `- ${a.source_url} ${a.people}: ${a.title}`),
    '',
    'Then call save_scan once. Do not use the em dash character.',
  ].join('\n');
  await run(prompt, 'haiku', [save], 40);
  if (!saved) throw new Error('Haiku did not save the scan');
  const urgent = saveScan(db, saved, now);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('slack:last', ?)").run(String(now));
  return { chats: (saved as ScanResult).chats.length, asks: (saved as ScanResult).asks.length, urgent };
}

async function pushUrgent(c: SlackConfig, urgent: Awaited<ReturnType<typeof scanSlack>>['urgent'], now = Date.now()) {
  if (!pushHours(c, now)) return;
  for (const a of urgent) {
    const actions = `view, Open, ${a.url}; http, Make task, ${HUB_URL}/slack/accept?id=${encodeURIComponent(a.id)}, method=POST, clear=true`;
    await pushNtfy(`${a.from}: ${a.title}`, a.chat, a.quote, a.url, actions).catch(() => false);
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
      applyChanges(db, [{ table: 'items', id, profile: PROFILE, updated_at: Date.now(), fields: { title: a.title.trim(), text: a.quote.trim(), source: 'slack', source_url: a.url, people: `${a.from} · ${a.chat}`, at: null, status: 'suggested' } }]);
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

export function acceptAsk(db: Database, id: string, now = Date.now()) {
  const row = db.prepare("SELECT 1 FROM items WHERE profile = ? AND id = ? AND source = 'slack'").get(PROFILE, id);
  if (!row) return false;
  applyChanges(db, [{ table: 'items', id, profile: PROFILE, updated_at: now, fields: { status: 'open' } }]);
  return true;
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
      console.log(`slack: ${r.chats} chats, ${r.asks} asks, ${r.urgent.length} urgent`);
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
