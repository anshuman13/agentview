import path from 'node:path';
import type { SavedSession } from '../../../../shared/protocol.js';
import { jsonFile } from '../../json.js';
import { STATE_DIR } from '../claude/accounts.js';

// Codex keeps its threads in its own store; this is the list AgentView shows for them, with the folder each one ran in.
export type SavedThread = { cwd: string; summary: string; lastModified: number };

const store = jsonFile<Record<string, SavedThread>>(path.join(STATE_DIR, 'codex-chats.json'), {});

export const codexThread = async (id: string) => (await store.read())[id] ?? null;

export const noteThread = (id: string, patch: Partial<SavedThread> & { cwd: string }) =>
  store.update((all) => ({ ...all, [id]: { ...all[id], summary: all[id]?.summary ?? '', lastModified: Date.now(), ...patch } }));

export const forgetThread = async (id: string) => {
  let had = false;
  await store.update((all) => {
    had = id in all;
    if (!had) return all;
    const { [id]: _gone, ...rest } = all;
    return rest;
  });
  return had;
};

export const codexSessions = async (): Promise<SavedSession[]> =>
  Object.entries(await store.read()).map(([sessionId, t]) => ({ sessionId, title: t.summary, cwd: t.cwd, gitBranch: null, lastModified: t.lastModified, provider: 'codex' }));
