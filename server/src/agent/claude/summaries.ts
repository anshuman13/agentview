import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Account, ChatEvent } from '../../../../shared/protocol.js';
import { listAll } from '../allChats.js';
import { provider } from '../registry.js';
import { configDir, freshAccount, isLimited, stopOnOverage, verifyLimit } from './accounts.js';
import { listBin } from './bin.js';
import { readSummaries, saveSummaries, type Summaries } from './summaryStore.js';

const EVERY = 30 * 60_000;
const IDLE = 2 * 3600_000;
const PER_PASS = 5;
const EXCERPT = 4000;
const MAX_LINE = 120;
const TIMEOUT = 60_000;

type Chat = { sessionId: string; lastModified: number };

// The idle chats whose last message is newer than their summary, most recent first, at most one pass worth.
export function pickChats<T extends Chat>(chats: T[], summaries: Summaries, skip: Set<string>, now = Date.now()) {
  return chats
    .filter((c) => !skip.has(c.sessionId) && now - c.lastModified >= IDLE && c.lastModified > (summaries[c.sessionId]?.at ?? 0))
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, PER_PASS);
}

// The last EXCERPT characters of the prompts and top-level replies in a chat's events.
export function excerptOf(events: ChatEvent[]) {
  const lines = events.flatMap((e) => {
    if (e.kind === 'user') return [`User: ${e.text}`];
    return e.kind === 'assistant' && !e.parent ? [`Assistant: ${e.text}`] : [];
  });
  return lines.join('\n').slice(-EXCERPT);
}

export const summaryPrompt = (firstPrompt: string, excerpt: string) => [
  `Write one plain line under ${MAX_LINE} characters saying what this chat did or decided. No quotes, no markdown, no em dash, no preamble.`,
  '',
  `First prompt: ${firstPrompt.replace(/\s+/g, ' ').trim().slice(0, 300)}`,
  '',
  'End of the chat:',
  excerpt,
].join('\n');

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE);

async function haiku(prompt: string, account: Account) {
  const dir = configDir(account);
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TIMEOUT);
  try {
    const q = query({ prompt, options: { model: 'haiku', persistSession: false, settingSources: [], maxTurns: 1, tools: [], thinking: { type: 'disabled' }, abortController, env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) } } });
    for await (const m of q) {
      stopOnOverage(account, m);
      if (m.type === 'result') return m.subtype === 'success' ? m.result : '';
    }
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// An empty or failed answer is saved as an empty summary, so the chat is not retried until it changes.
// Summaries are kept as each chat finishes, so an overage stop only leaves the rest for the next pass.
async function summarisePass(running: Set<string>) {
  const [list, bin, summaries] = await Promise.all([listAll(), listBin(), readSummaries()]);
  const skip = new Set([...running, ...bin.map((b) => b.sessionId)]);
  for (const x of pickChats(list, summaries, skip)) {
    const account = x.cwd ? freshAccount(x.cwd) : 'main';
    if (await verifyLimit(account)) continue;
    const events = await provider(x.provider ?? 'claude').transcripts.read(x.sessionId).catch(() => null);
    const text = oneLine(await haiku(summaryPrompt(x.firstPrompt ?? '', excerptOf(events ?? [])), account).catch((err) => {
      if (isLimited(account)) throw err;
      return '';
    }));
    await saveSummaries({ [x.sessionId]: { text, at: Date.now() } });
  }
}

let busy = false;

export function startSummaries(running: () => Set<string>) {
  setInterval(() => {
    if (busy) return;
    busy = true;
    void summarisePass(running()).catch(() => {}).finally(() => { busy = false; });
  }, EVERY).unref();
}
