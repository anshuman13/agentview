import { query } from '@anthropic-ai/claude-agent-sdk';
import { configDir, guardLimit, verifyLimit } from './accounts.js';
import { listBin } from './bin.js';
import { messageLine } from './search.js';
import { listSessions, readTail } from './sessions.js';
import { readSummaries, saveSummaries, type Summaries } from './summaryStore.js';

const EVERY = 30 * 60_000;
const IDLE = 2 * 3600_000;
const PER_PASS = 5;
const EXCERPT = 4000;
const MAX_LINE = 120;

type Chat = { sessionId: string; lastModified: number };

// The idle chats whose last message is newer than their summary, most recent first, at most one pass worth.
export function pickChats<T extends Chat>(chats: T[], summaries: Summaries, skip: Set<string>, now = Date.now()) {
  return chats
    .filter((c) => !skip.has(c.sessionId) && now - c.lastModified >= IDLE && c.lastModified > (summaries[c.sessionId]?.at ?? 0))
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, PER_PASS);
}

// The last EXCERPT characters of the prompts and replies in a transcript tail.
export function excerptOf(tail: string) {
  const lines = tail.split('\n').flatMap((l) => {
    const m = messageLine(l);
    return m ? [`${m.role === 'user' ? 'User' : 'Claude'}: ${m.text}`] : [];
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

async function haiku(prompt: string) {
  const dir = configDir('main');
  const q = query({ prompt, options: { model: 'haiku', persistSession: false, settingSources: [], maxTurns: 1, tools: [], thinking: { type: 'disabled' }, env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) } } });
  for await (const m of q) if (m.type === 'result') return m.subtype === 'success' ? m.result : '';
  return '';
}

// Summaries are kept as each chat finishes, so a failed run only leaves the rest for the next pass.
async function summarisePass(running: Set<string>) {
  if (await verifyLimit('main')) return;
  guardLimit('main');
  const [list, bin, summaries] = await Promise.all([listSessions({ limit: 300 }), listBin(), readSummaries()]);
  const skip = new Set([...running, ...bin.map((b) => b.sessionId)]);
  for (const x of pickChats(list, summaries, skip)) {
    const text = oneLine(await haiku(summaryPrompt(x.firstPrompt ?? '', excerptOf(await readTail(x)))));
    if (text) await saveSummaries({ [x.sessionId]: { text, at: Date.now() } });
  }
}

export function startSummaries(running: () => Set<string>) {
  setInterval(() => void summarisePass(running()).catch(() => {}), EVERY).unref();
}
