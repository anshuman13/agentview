import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deleteSession, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { BIN_MS, type BinnedSession } from '../../../../shared/protocol.js';

const FILE = path.join(os.homedir(), '.agentview', 'bin.json');

const load = (): Promise<BinnedSession[]> => readFile(FILE, 'utf8').then(JSON.parse).catch(() => []);
const save = async (list: BinnedSession[]) => {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(list, null, 2));
};

export async function listBin(now = Date.now()) {
  const list = await load();
  const expired = list.filter((b) => now - b.deletedAt > BIN_MS);
  if (!expired.length) return list;
  for (const b of expired) await deleteSession(b.sessionId, { dir: b.cwd }).catch(() => undefined);
  const kept = list.filter((b) => !expired.includes(b));
  await save(kept);
  return kept;
}

export async function removeSession(id: string, purge: boolean) {
  const info = await getSessionInfo(id);
  const list = await load();
  if (!info) {
    await save(list.filter((b) => b.sessionId !== id));
    return { purged: true };
  }
  if (purge || Date.now() - info.lastModified > BIN_MS) {
    await deleteSession(id, { dir: info.cwd });
    await save(list.filter((b) => b.sessionId !== id));
    return { purged: true };
  }
  const entry = { sessionId: id, title: info.summary, cwd: info.cwd ?? '', lastModified: info.lastModified, deletedAt: Date.now() };
  await save([...list.filter((b) => b.sessionId !== id), entry]);
  return { purged: false };
}

export async function restoreSession(id: string) {
  await save((await load()).filter((b) => b.sessionId !== id));
}
