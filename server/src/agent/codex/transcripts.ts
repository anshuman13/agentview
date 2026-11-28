import os from 'node:os';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import type { ChatEvent, SavedSession } from '../../../../shared/protocol.js';
import { commitOf, snippetAround } from '../transcriptText.js';
import type { MessageHit } from '../types.js';
import { historyEvents, rolloutPlan } from './events.js';
import type { Thread, ThreadListResponse } from './protocol.js';
import { codexAdmin } from './rpc.js';
import { codexSessions, codexTranscript } from './threads.js';

type Rpc = { request<T>(method: string, params: unknown): Promise<T> };

export async function threadEvents(thread: Thread): Promise<ChatEvent[]> {
  const rollout = thread.path ?? codexTranscript(thread.id);
  const plan = rollout ? rolloutPlan(await readFile(rollout, 'utf8').catch(() => '')) : null;
  return historyEvents(thread.turns, thread.updatedAt * 1000, plan);
}

// Threads Codex lists, including ones started outside AgentView, with AgentView's own titles winning.
export function mergeThreads(threads: Thread[], saved: SavedSession[]): SavedSession[] {
  const ours = new Map(saved.map((s) => [s.sessionId, s]));
  const listed = threads.map((t): SavedSession => {
    const own = ours.get(t.id);
    ours.delete(t.id);
    return { sessionId: t.id, title: own?.title || t.name || t.preview, cwd: t.cwd, gitBranch: t.gitInfo?.branch ?? null, lastModified: t.updatedAt * 1000, provider: 'codex' };
  });
  return [...listed, ...ours.values()];
}

export async function listThreads(rpc: Rpc, limit = 200): Promise<Thread[]> {
  const { data } = await rpc.request<ThreadListResponse>('thread/list', { limit, sortKey: 'updated_at' });
  return data;
}

export async function readThread(rpc: Rpc, threadId: string): Promise<ChatEvent[] | null> {
  const { thread } = await rpc.request<{ thread: Thread }>('thread/read', { threadId, includeTurns: true }).catch(() => ({ thread: null }));
  return thread ? threadEvents(thread) : null;
}

export async function codexList(): Promise<SavedSession[]> {
  const saved = await codexSessions();
  const threads = await codexAdmin().then(listThreads).catch(() => null);
  return threads ? mergeThreads(threads, saved) : saved;
}

export const codexRead = (id: string) => codexAdmin().then((rpc) => readThread(rpc, id), () => null);

export const CODEX_SESSIONS = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');

async function rollouts(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
  return entries.filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
}

const parse = (line: string) => { try { return JSON.parse(line); } catch { return null; } };

// One rollout line as a hit when it is a prompt or reply that holds every word.
export function rolloutHit(line: string, words: string[], sessionId: string): MessageHit | null {
  const o = parse(line);
  const p = o?.payload;
  if (o?.type !== 'response_item' || p?.type !== 'message' || (p.role !== 'user' && p.role !== 'assistant') || !Array.isArray(p.content)) return null;
  const text = p.content.map((c: { text?: unknown }) => (typeof c?.text === 'string' ? c.text : '')).join('\n').replace(/\s+/g, ' ').trim();
  if (!text || text.startsWith('<')) return null;
  const low = text.toLowerCase();
  if (!words.every((w) => low.includes(w))) return null;
  return { sessionId, role: p.role, text: snippetAround(text, low.indexOf(words[0])), at: o.timestamp ?? '' };
}

// Prompts and replies in Codex rollout files that hold every word, newest first, at most 3 per thread.
export async function searchRollouts(words: string[], max: number, dir = CODEX_SESSIONS): Promise<MessageHit[]> {
  words = words.map((w) => w.toLowerCase()).filter(Boolean);
  if (!words.length) return [];
  const hits: MessageHit[] = [];
  for (const file of await rollouts(dir)) {
    const lines = (await readFile(file, 'utf8').catch(() => '')).split('\n');
    const id = parse(lines[0])?.payload?.id ?? path.basename(file, '.jsonl').slice(-36);
    const per: MessageHit[] = [];
    for (const line of lines) {
      if (!line.toLowerCase().includes(words[0])) continue;
      const hit = rolloutHit(line, words, id);
      if (hit) per.push(hit);
    }
    hits.push(...per.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3));
  }
  return hits.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

// The first git commit a rollout's command runs printed, or null.
export function rolloutCommit(text: string) {
  for (const line of text.split('\n')) {
    if (!line.includes('CommandExecution')) continue;
    const item = parse(line)?.payload?.item;
    if (item?.type !== 'CommandExecution' || item.exit_code !== 0) continue;
    const cmd = Array.isArray(item.command) ? item.command.join(' ') : String(item.command ?? '');
    if (!/\bgit\b[^\n]*\bcommit\b/.test(cmd)) continue;
    const c = commitOf(String(item.aggregated_output ?? ''));
    if (c) return c;
  }
  return null;
}

async function rolloutFile(id: string, dir: string) {
  return codexTranscript(id) ?? (await rollouts(dir)).find((f) => f.endsWith(`${id}.jsonl`)) ?? null;
}

export async function codexFirstCommit(id: string, dir = CODEX_SESSIONS) {
  const file = await rolloutFile(id, dir);
  return file ? rolloutCommit(await readFile(file, 'utf8').catch(() => '')) : null;
}
