import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from '../../json.js';
import { serial } from './bin.js';

const file = () => path.join(os.homedir(), '.agentview', 'seen.json');

const load = () => readJson<Record<string, number>>(file(), {});

export const listSeen = () => serial(load);

export const markSeen = (id: string) => serial(async () => {
  await writeJson(file(), { ...(await load()), [id]: Date.now() }, { pretty: true });
});

export const unseen = (id: string) => serial(async () => {
  const map = await load();
  if (id in map) {
    delete map[id];
    await writeJson(file(), map, { pretty: true });
  }
});

export const seenRoute = async (method: string, id: string | null): Promise<{ status: number; body: unknown }> => {
  if (method === 'GET') return { status: 200, body: await listSeen() };
  if (method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  if (!id) return { status: 400, body: { error: 'id is required' } };
  await markSeen(id);
  return { status: 200, body: { ok: true } };
};
