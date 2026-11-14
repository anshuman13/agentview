import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { isLimited } from '../../../server/src/agent/claude/accounts.js';
import { ACCOUNT_OF } from '../calendar/calendar.js';
import { ask } from '../core/claude.js';
import { getMeta, setMeta, type Profile } from '../core/db.js';
import { applyChanges, type Change } from '../core/sync.js';
import { norm } from './wikiUpdates.js';

const MAX_CLAIMS = 3;
const SECRET = /[a-z0-9]{24,}|sk-|ghp_|xox|password/i;

export type ChatEvent = { id: string; kind: string; text: string; at: number };
export type Chat = { chat: string; title: string; profile: Profile; events: ChatEvent[] };
type Learned = { proposed: number } | { skipped: 'limit' };

const cursorKey = (profile: Profile, chat: string) => `learn:${profile}:${chat}`;

function known(db: Database, profile: Profile) {
  return db.prepare("SELECT text, page_id, state FROM facts WHERE profile = ? AND deleted = 0 AND text IS NOT NULL AND text != ''").all(profile) as { text: string; page_id: string | null; state: string | null }[];
}

// Saves each claim as a proposed memory claim from the chat, unless a claim with the same text exists in any state or it looks like a secret.
function saveLearned(db: Database, c: Chat, claims: string[], now = Date.now()) {
  const seen = new Set(known(db, c.profile).map((f) => norm(f.text)));
  const changes: Change[] = [];
  for (const raw of claims) {
    if (changes.length === MAX_CLAIMS) break;
    const text = raw.trim().replace(/\s+/g, ' ');
    if (!text || SECRET.test(text) || seen.has(norm(text))) continue;
    seen.add(norm(text));
    changes.push({
      table: 'facts', id: `learn:${createHash('sha1').update(norm(text)).digest('hex').slice(0, 16)}`, profile: c.profile, updated_at: now,
      fields: { text, page_id: null, heading: null, at: now, state: 'proposed', replaces: null, added_by: `claude:${c.chat}`, sources: JSON.stringify([{ kind: 'chat', label: c.title }]) },
    });
  }
  return applyChanges(db, changes).applied;
}

async function decide(c: Chat, events: ChatEvent[], memory: string[]) {
  const claims: string[] = [];
  const save = tool('save_claim', 'Save one preference or correction the user taught in the chat.', {
    text: z.string().max(400).describe('One or two sentences that lead with the subject'),
  }, async (a) => {
    claims.push(a.text);
    return { content: [{ type: 'text' as const, text: 'saved' }] };
  });
  const prompt = [
    'Below is a chat between me and Claude. Find the preferences and corrections I stated or made about how I want work done, such as tools to use, style, or habits to avoid.',
    `For each, call save_claim with one or two specific sentences that lead with the subject. Save at most ${MAX_CLAIMS}.`,
    'Save nothing when I taught nothing. Never save a secret, credential, token, password, URL with a key in it or file contents. Skip what is already known. Do not use the em dash character. Do not do anything else.',
    '',
    'Already known:',
    ...(memory.length ? memory.map((t) => `- ${t}`) : ['(nothing)']),
    '',
    'Chat:',
    ...events.map((e) => `${e.kind === 'user' ? 'Me' : 'Claude'}: ${e.text}`),
  ].join('\n');
  for await (const msg of ask(ACCOUNT_OF[c.profile], prompt, {
    model: 'haiku',
    maxTurns: 6,
    cwd: os.tmpdir(),
    tools: [],
    thinking: { type: 'disabled' },
    env: { ENABLE_TOOL_SEARCH: 'false' },
    mcpServers: { wiki: createSdkMcpServer({ name: 'wiki', tools: [save] }) },
    allowedTools: ['mcp__wiki__save_claim'],
    permissionMode: 'dontAsk',
  }, undefined, 'learn')) {
    if (msg.type === 'result' && msg.subtype !== 'success' && !claims.length) throw new Error(`Learning from a chat ended with ${msg.subtype}`);
  }
  return claims;
}

// Reads the user and assistant events of a chat after the cursor and proposes what the user taught as memory claims. The cursor moves only after a run that finished.
export async function learnFromChat(db: Database, c: Chat, now = Date.now(), run = decide): Promise<Learned> {
  const key = cursorKey(c.profile, c.chat);
  const cursor = Number(getMeta(db, key) ?? 0);
  const events = c.events.filter((e) => (e.kind === 'user' || e.kind === 'assistant') && e.at > cursor);
  if (!events.some((e) => e.kind === 'user')) return { proposed: 0 };
  if (isLimited(ACCOUNT_OF[c.profile])) return { skipped: 'limit' };
  // Live claims only: saveLearned already skips a claim whose text exists in any state.
  const memory = known(db, c.profile).filter((f) => !f.page_id && (f.state === null || f.state === 'live')).map((f) => f.text);
  const claims = await run(c, events, memory);
  const proposed = saveLearned(db, c, claims, now);
  setMeta(db, key, String(Math.max(...events.map((e) => e.at))));
  return { proposed };
}
