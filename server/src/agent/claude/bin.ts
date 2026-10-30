import os from 'node:os';
import path from 'node:path';
import { deleteSession, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { BIN_MS, type BinnedSession } from '../../../../shared/protocol.js';
import { readJson, writeJson } from '../../json.js';

const FILE = path.join(os.homedir(), '.agentview', 'bin.json');

const load = (): Promise<BinnedSession[]> => readJson<BinnedSession[]>(FILE, []);
const save = async (list: BinnedSession[]) => {
  await writeJson(FILE, list, { pretty: true });
};
// Each change reads and rewrites the file, so changes run one at a time.
let lock: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const run = lock.then(f, f);
  lock = run.catch(() => undefined);
  return run;
};

export const listBin = (now = Date.now()) => serial(async () => {
  const list = await load();
  const expired = list.filter((b) => now - b.deletedAt > BIN_MS);
  if (!expired.length) return list;
  for (const b of expired) await deleteSession(b.sessionId, { dir: b.cwd }).catch(() => undefined);
  const kept = list.filter((b) => !expired.includes(b));
  await save(kept);
  return kept;
});

export const removeSession = (id: string, purge: boolean) => serial(async () => {
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
});

export const emptyBin = () => serial(async () => {
  const failed: BinnedSession[] = [];
  for (const b of await load()) await deleteSession(b.sessionId, { dir: b.cwd }).catch(() => failed.push(b));
  await save(failed);
});

export const restoreSession = (id: string) => serial(async () => save((await load()).filter((b) => b.sessionId !== id)));
