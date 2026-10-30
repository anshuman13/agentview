import os from 'node:os';
import type { Database } from 'bun:sqlite';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir, guardLimit, stopOnOverage } from '../../server/src/agent/claude/accounts.js';
import { BadRequest } from '../../server/src/http/body.js';
import { ACCOUNT_OF } from './calendar.js';
import { type Profile } from './db.js';
import { once } from './once.js';
import { applyChanges } from './sync.js';

export type Block = { profile: Profile; id: string; start: number; end: number; title: string };
type Created = { url: string | null };

const MAX = 8 * 3600_000;

export const blockId = (itemId: string) => `block:${itemId}`;

export function checkBlock(db: Database, b: Block) {
  if (!Number.isFinite(b.start) || !Number.isFinite(b.end) || b.end <= b.start || b.end - b.start > MAX) return 'Invalid start or end';
  if (!b.title.trim() || b.title.length > 200) return 'Invalid title';
  const item = db.prepare("SELECT 1 FROM items WHERE profile = ? AND id = ? AND deleted = 0 AND status = 'open'").get(b.profile, b.id);
  return item ? null : 'No such open task';
}

export async function createEvent(b: Block): Promise<Created> {
  let made: Created | null = null;
  const save = tool('event_created', 'Report the event you created.', { url: z.string().optional().describe('The event link in Google Calendar') }, async (a) => {
    made = { url: a.url ?? null };
    return { content: [{ type: 'text', text: 'saved' }] };
  });
  const account = ACCOUNT_OF[b.profile];
  guardLimit(account);
  const dir = configDir(account);
  const prompt = [
    `Create one event on my primary Google Calendar titled ${JSON.stringify(b.title)},`,
    `from ${new Date(b.start).toISOString()} to ${new Date(b.end).toISOString()}, with no attendees, no description and no video call.`,
    'Then call event_created once with its link. Do not do anything else.',
  ].join(' ');
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
      allowedTools: ['mcp__claude_ai_Google_Calendar__create_event', 'mcp__codex__event_created'],
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

// Creates the calendar event, then moves the task to the block start and keeps the block as a meeting row the import leaves alone.
export function addBlock(db: () => Database, b: Block, create = createEvent, now = Date.now) {
  return once(`block:${b.profile}:${b.id}`, async () => {
    const bad = checkBlock(db(), b);
    if (bad) throw new BadRequest(bad);
    const { url } = await create(b);
    const t = now();
    applyChanges(db(), [
      { table: 'items', id: b.id, profile: b.profile, updated_at: t, fields: { at: b.start, rolls: null, rolled_from: null } },
      { table: 'meetings', id: blockId(b.id), profile: b.profile, updated_at: t, deleted: false, fields: { title: b.title, starts_at: b.start, ends_at: b.end, people: '[]', calendar_url: url } },
    ]);
    return { id: blockId(b.id), url };
  });
}
