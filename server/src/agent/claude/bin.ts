import os from 'node:os';
import path from 'node:path';
import { deleteSession, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { BIN_MS, type BinnedSession } from '../../../../shared/protocol.js';
import { jsonFile } from '../../json.js';

const store = jsonFile<BinnedSession[]>(path.join(os.homedir(), '.agentview', 'bin.json'), []);

export const listBin = (now = Date.now()) => store.update(async (list) => {
  const expired = list.filter((b) => now - b.deletedAt > BIN_MS);
  if (!expired.length) return list;
  for (const b of expired) await deleteSession(b.sessionId, { dir: b.cwd }).catch(() => undefined);
  return list.filter((b) => !expired.includes(b));
});

export const removeSession = async (id: string, purge: boolean, archive = false) => {
  let purged = true;
  await store.update(async (list) => {
    const info = await getSessionInfo(id);
    if (!info) return list.filter((b) => b.sessionId !== id);
    if (purge || (!archive && Date.now() - info.lastModified > BIN_MS)) {
      await deleteSession(id, { dir: info.cwd });
      return list.filter((b) => b.sessionId !== id);
    }
    purged = false;
    const entry = { sessionId: id, title: info.summary, cwd: info.cwd ?? '', lastModified: info.lastModified, deletedAt: Date.now() };
    return [...list.filter((b) => b.sessionId !== id), entry];
  });
  return { purged };
};

export const emptyBin = async () => {
  await store.update(async (list) => {
    const failed: BinnedSession[] = [];
    for (const b of list) await deleteSession(b.sessionId, { dir: b.cwd }).catch(() => failed.push(b));
    return failed;
  });
};

export const restoreSession = async (id: string) => {
  await store.update((list) => list.filter((b) => b.sessionId !== id));
};
