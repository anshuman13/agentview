import os from 'node:os';
import type { Database } from 'bun:sqlite';
import { createSdkMcpServer, query, tool, type HookInput, type HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { blockId } from '../../shared/util.js';
import { configDir, guardLimit, stopOnOverage } from '../../server/src/agent/claude/accounts.js';
import { BadRequest } from '../../server/src/http/body.js';
import { ACCOUNT_OF } from './calendar.js';
import { type Profile } from './db.js';
import { once } from './once.js';
import { applyChanges } from './sync.js';

export type Block = { profile: Profile; id: string; start: number; end: number; title: string };
type Created = { url: string | null };

const MAX = 8 * 3600_000;
const DELETE = 'mcp__claude_ai_Google_Calendar__delete_event';

export const onlyEvent = (input: HookInput, id: string | null): HookJSONOutput => {
  const args = (input.hook_event_name === 'PreToolUse' ? input.tool_input : {}) as { eventId?: unknown; calendarId?: unknown };
  const ok = id != null && args.eventId === id && (args.calendarId ?? 'primary') === 'primary';
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: ok ? 'allow' : 'deny', permissionDecisionReason: ok ? undefined : 'Only the old focus block may be deleted.' } };
};

// The event id inside a Google Calendar event link: eid is base64url of the event id and the calendar id.
export function eventIdOf(url: string | null) {
  const eid = url && URL.canParse(url) ? new URL(url).searchParams.get('eid') : null;
  const id = eid ? Buffer.from(eid, 'base64url').toString().split(' ')[0] : '';
  return /^[a-z0-9_]+$/i.test(id) ? id : null;
}

export function checkBlock(db: Database, b: Block) {
  if (!Number.isFinite(b.start) || !Number.isFinite(b.end) || b.end <= b.start || b.end - b.start > MAX) return 'Invalid start or end';
  if (!b.title.trim() || b.title.length > 200) return 'Invalid title';
  const item = db.prepare("SELECT 1 FROM items WHERE profile = ? AND id = ? AND deleted = 0 AND status = 'open'").get(b.profile, b.id);
  return item ? null : 'No such open task';
}

export async function createEvent(b: Block, old: string | null): Promise<Created> {
  let made: Created | null = null;
  const save = tool('event_created', 'Report the event you created.', { url: z.string().optional().describe('The event link in Google Calendar') }, async (a) => {
    made = { url: a.url ?? null };
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const account = ACCOUNT_OF[b.profile];
  guardLimit(account);
  const dir = configDir(account);
  const prompt = [
    old ? `Delete the event with id ${old} from my primary Google Calendar with no notifications; if it is already gone, go on.` : '',
    `Create one event on my primary Google Calendar titled ${JSON.stringify(b.title)},`,
    `from ${new Date(b.start).toISOString()} to ${new Date(b.end).toISOString()}, with no attendees, no description and no video call.`,
    'Then call event_created once with its link. Do not do anything else.',
  ].filter(Boolean).join(' ');
  for await (const m of query({
    prompt,
    options: {
      persistSession: false,
      model: 'haiku',
      thinking: { type: 'disabled' },
      maxTurns: 4,
      cwd: os.tmpdir(),
      settingSources: [],
      env: { ...process.env, ENABLE_TOOL_SEARCH: 'false', ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      mcpServers: { codex: createSdkMcpServer({ name: 'codex', tools: [save] }) },
      allowedTools: ['mcp__claude_ai_Google_Calendar__create_event', 'mcp__codex__event_created', ...(old ? [DELETE] : [])],
      hooks: { PreToolUse: [{ matcher: DELETE, hooks: [async (input) => onlyEvent(input, old)] }] },
      permissionMode: 'dontAsk',
    },
  })) {
    stopOnOverage(account, m);
    if (made) break;
    if (m.type === 'result' && m.subtype !== 'success') throw new Error(`Calendar block ended with ${m.subtype}`);
  }
  if (!made) throw new Error('Claude did not confirm the event; check the calendar before trying again');
  return made;
}

// Creates the calendar event, deleting the task's earlier block event if there is one, then moves the task to the block start and keeps the block as a meeting row the import leaves alone.
export function addBlock(db: () => Database, b: Block, create = createEvent, now = Date.now) {
  return once(`block:${b.profile}:${b.id}`, async () => {
    const bad = checkBlock(db(), b);
    if (bad) throw new BadRequest(bad);
    const old = db().prepare('SELECT calendar_url FROM meetings WHERE profile = ? AND id = ? AND deleted = 0').get(b.profile, blockId(b.id)) as { calendar_url: string | null } | null;
    const { url } = await create(b, eventIdOf(old?.calendar_url ?? null));
    const t = now();
    applyChanges(db(), [
      { table: 'items', id: b.id, profile: b.profile, updated_at: t, fields: { at: b.start, rolls: null, rolled_from: null } },
      { table: 'meetings', id: blockId(b.id), profile: b.profile, updated_at: t, deleted: false, fields: { title: b.title, starts_at: b.start, ends_at: b.end, people: '[]', calendar_url: url } },
    ]);
    return { id: blockId(b.id), url };
  });
}
