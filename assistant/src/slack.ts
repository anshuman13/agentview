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
  new_messages: z.number().describe('How many new messages you read in this chat since the last pass'),
});
const Ask = z.object({
  url: z.string().describe('Permalink of the message'),
  from: z.string().describe('Who asked'),
  chat: z.string().describe('#channel-name, or "DM" for a direct message; never an id'),
  title: z.string().describe('Short imperative task for me'),
  quote: z.string().describe('The key sentence of the message'),
  urgent: z.boolean().describe('True only if someone is blocked on me, there is a deadline today, an incident, or I was pinged more than once'),
});
const Detail = z.object({
  id: z.string().describe('The id in brackets of the open ask or tracked task'),
  note: z.string().describe('The new detail in one sentence: a date, a requirement, a link, a change of scope or who owns it'),
  from: z.string().describe('Who said it'),
  url: z.string().describe('Permalink of the message'),
});
export type ScanResult = { chats: (Omit<z.infer<typeof Chat>, 'new_messages'> & { new_messages?: number })[]; asks: z.infer<typeof Ask>[]; answered: string[]; details?: z.infer<typeof Detail>[]; channels?: { name: string; id: string }[] };

export const askId = (url: string) => `slack:${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;

// Saves one scan: chat summaries, asks as items to review, and closes asks I have replied to. Returns how many asks are new and which are urgent.
export function saveScan(db: Database, r: ScanResult, now = Date.now()) {
  const has = db.prepare('SELECT status FROM items WHERE profile = ? AND id = ?');
  // A chat with nothing new keeps its running summary.
  const changes: Change[] = r.chats.filter((c) => c.new_messages !== 0).map((c) => ({ table: 'chats', id: c.id, profile: PROFILE, updated_at: now, fields: { name: c.name, kind: c.kind, url: c.url ?? null, summary: c.summary.trim(), last_at: now } }));
  const urgent: (ScanResult['asks'][number] & { id: string })[] = [];
  let added = 0;
  for (const a of r.asks) {
    const id = askId(a.url);
    if (has.get(PROFILE, id)) continue;
    changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { title: a.title.trim(), text: a.quote.trim(), source: 'slack', source_url: a.url, people: `${a.from} · ${a.chat}`, at: null, status: 'suggested' } });
    added++;
    if (a.urgent) urgent.push({ ...a, id });
  }
  for (const url of r.answered) {
    const id = askId(url);
    const old = has.get(PROFILE, id) as { status: string } | null;
    if (old && (old.status === 'suggested' || old.status === 'unassigned')) changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { status: 'done' } });
  }
  // New details from Slack go at the end of the task's notes, once per message.
  const task = db.prepare("SELECT text FROM items WHERE profile = ? AND id = ? AND deleted = 0 AND status IN ('open', 'suggested')");
  const texts = new Map<string, string>();
  for (const d of r.details ?? []) {
    const row = task.get(PROFILE, d.id) as { text: string | null } | null;
    if (!row) continue;
    const text = texts.get(d.id) ?? row.text ?? '';
    if (text.includes(d.url)) continue;
    texts.set(d.id, `${text ? `${text}\n\n` : ''}${d.from} on Slack: ${d.note.trim()} ${d.url}`);
  }
  for (const [id, text] of texts) changes.push({ table: 'items', id, profile: PROFILE, updated_at: now, fields: { text } });
  applyChanges(db, changes);
  return { added, urgent };
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

// Stops as soon as done() says the work is saved, so the model does not spend turns repeating itself.
async function run(prompt: string, model: 'haiku' | 'sonnet', tools: Tools, maxTurns: number, done = () => false) {
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
      env: { ...process.env, ENABLE_TOOL_SEARCH: 'false', ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      ...(model === 'haiku' && { thinking: { type: 'disabled' as const } }),
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
    if (m.type === 'user' && done()) break;
  }
  return result;
}

const openAsks = (db: Database, since: number) =>
  db.prepare("SELECT id, title, source_url, people FROM items WHERE profile = ? AND deleted = 0 AND source = 'slack' AND status IN ('suggested', 'open') AND updated_at > ?").all(PROFILE, since) as { id: string; title: string; source_url: string; people: string }[];
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
  const save = tool('save_scan', 'Save what you found. Call once at the end.', { chats: z.array(Chat), asks: z.array(Ask), answered: z.array(z.string()).describe('Permalinks from the open asks that I have since replied to or that are resolved'), details: z.array(Detail).describe('New details on the open asks or tracked tasks below'), channels: z.array(z.object({ name: z.string(), id: z.string() })).describe('Every watched channel you read, by name without # and id') }, async (a) => {
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
    'In answered, list permalinks of the open asks below that I have replied to or that someone resolved.',
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
  await run(prompt, 'haiku', [save], 40, () => saved != null);
  if (!saved) throw new Error('Haiku did not save the scan');
  keepChannelIds(db, c, saved);
  const { added, urgent } = saveScan(db, saved, now);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('slack:last', ?)").run(String(now));
  return { chats: (saved as ScanResult).chats.length, asks: added, urgent };
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
