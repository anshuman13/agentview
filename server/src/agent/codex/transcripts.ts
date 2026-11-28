import { readFile } from 'node:fs/promises';
import type { ChatEvent, SavedSession } from '../../../../shared/protocol.js';
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
