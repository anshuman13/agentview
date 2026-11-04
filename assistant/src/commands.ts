import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { pushNtfy } from '../../server/src/integrations/notify.js';
import { ANSWERED, CHANGED, postReply } from './autopilot.js';
import { deleteMeta, getMeta, setMeta } from './db.js';
import { PROFILE, webUrl } from './slackSave.js';
import { applyChanges } from './sync.js';
import { voiceLines } from './voice.js';
import { run, slackConfig, type Usage } from './slack.js';
import { DAY, MIN, slotStart, workSlotDue } from './time.js';
import { loop } from './once.js';
import { scanPaused } from './claude.js';
import { ACCOUNT_OF } from './calendar.js';
import { autopilotConfig, modeOf } from './autopilot.js';

// A message I write to myself in Slack that starts with "bot" is a task for the hub: it runs once as a job on the mini
// and the result is posted back in that thread.
export const Command = z.object({
  text: z.string().describe('What I asked, without the leading "bot"'),
  url: z.string().describe('Permalink of my message'),
});

export const COMMAND_STEP = 'In commands, add each new message I wrote in my DM with myself (a DM whose only member is me) that starts with the word "bot" (any case, then a space, colon or comma): the text after that word and its permalink. Never add a message someone else wrote, or one from any other DM or channel.';

export const REPLY_PREFIX = 'Assistant: ';
const urlKey = (jobId: string) => `cmd:${jobId}`;
const jobIdOf = (url: string) => `cmd-${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
// A DM channel id starts with D, so a message in a channel or group DM is never taken as a command.
const inDm = (url: string) => /\/archives\/D[A-Z0-9]+\/p\d+/.test(url);

export function commandPrompt(db: Database, text: string) {
  return [
    `I sent you this from Slack: "${text.trim()}"`,
    '',
    'Do it for me. First call ask_context with the request to see what my wiki, meetings, Slack decisions and open tasks say. You may read Slack, Gmail, the calendar and the web. You cannot post or send anything to anyone: when I ask for a reply or message, write the draft in my voice for me to send.',
    'Use add_task for follow-ups I must do myself. Answer in a few short lines with links, as if replying to me in Slack.',
    ...voiceLines(db),
  ].join('\n');
}

// Turns new commands into one-off jobs that run at the next jobs tick; a permalink is taken once.
export function queueCommands(db: Database, list: z.infer<typeof Command>[], now = Date.now()) {
  const queued: string[] = [];
  for (const c of list) {
    const url = webUrl(c.url);
    if (!url || !inDm(url) || !c.text.trim()) continue;
    const id = jobIdOf(url);
    if (db.prepare('SELECT 1 FROM jobs WHERE profile = ? AND id = ?').get(PROFILE, id)) continue;
    applyChanges(db, [{ table: 'jobs', id, profile: PROFILE, updated_at: now, fields: { name: `Slack: ${c.text.trim().slice(0, 40)}`, schedule: null, prompt: commandPrompt(db, c.text), enabled: 0, next_run_at: now, tools: null } }]);
    setMeta(db, urlKey(id), url);
    queued.push(id);
  }
  return queued;
}

// After a command's job ran, posts its output in the thread of my message, or pushes when that fails.
export async function replyToCommand(db: Database, jobId: string, ok: boolean, output: string, post = postReply, notify = pushNtfy) {
  const url = getMeta(db, urlKey(jobId));
  if (!url) return;
  deleteMeta(db, urlKey(jobId));
  const text = `${REPLY_PREFIX}${ok ? output : `I could not do this: ${output}`}`.slice(0, 3500);
  try {
    const posted = await post(url, text);
    if (posted === ANSWERED || posted === CHANGED) await notify('Slack command done', '', output.slice(0, 500), url).catch(() => {});
  } catch (err) {
    await notify('Slack command done, reply not posted', '', output.slice(0, 500), url).catch(() => {});
    console.error('command reply:', err);
  }
}

const SEARCH = 'mcp__claude_ai_Slack__slack_search_public_and_private';

// A cheap Haiku pass between scans that only looks for new commands, so one waits minutes, not a quarter hour.
export async function pollCommands(db: Database, me: string, now = Date.now(), onUsage?: (u: Usage) => void) {
  const since = Math.max(Number(getMeta(db, 'cmd:last') ?? 0), now - DAY);
  const unix = Math.floor(since / 1000);
  let found: z.infer<typeof Command>[] | null = null;
  const save = tool('save_commands', 'Save the commands you found. Call once.', { commands: z.array(Command) }, async (a) => {
    found = a.commands;
    return { content: [{ type: 'text' as const, text: 'saved' }] };
  });
  const prompt = [
    `I am Slack user ${me}. Call slack_search_public_and_private once with keywords ["bot"], filters "is:dm", after="${unix}", sort "timestamp", include_context false. Do not send or change anything in Slack.`,
    COMMAND_STEP,
    'Then call save_commands once with them (an empty list when there are none) and stop.',
  ].join('\n');
  await run(prompt, 'haiku', [save], 4, () => found != null, [SEARCH], onUsage);
  setMeta(db, 'cmd:last', String(now));
  return queueCommands(db, found ?? [], now);
}

const POLL = 5 * MIN;

// Every 5 minutes in the scan's hours, skipping the quarter hours the full Slack scan already covers.
export function startCommands(db: () => Database) {
  let tried = 0;
  loop('commands', MIN, async () => {
    const now = Date.now();
    const c = slackConfig();
    const away = modeOf(autopilotConfig(db()), now) === 'away';
    if (!c || !workSlotDue(tried, POLL, now, away) || slotStart(now, POLL) === slotStart(now, 15 * MIN)) return;
    tried = now;
    if (await scanPaused(db(), ACCOUNT_OF[PROFILE], 'commands')) return;
    const queued = await pollCommands(db(), c.me, now);
    if (queued.length) console.log(`commands: ${queued.length} queued`);
  });
}
