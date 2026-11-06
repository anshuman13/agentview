import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from '../../json.js';
import { removeSession, serial } from './bin.js';

const file = () => path.join(os.homedir(), '.agentview', 'pins.json');

const load = () => readJson<string[]>(file(), []);

export const listPins = () => serial(load);

export const pin = (id: string) => serial(async () => {
  const list = await load();
  if (!list.includes(id)) await writeJson(file(), [id, ...list], { pretty: true });
});

export const unpin = (id: string) => serial(async () => {
  const list = await load();
  if (list.includes(id)) await writeJson(file(), list.filter((x) => x !== id), { pretty: true });
});

export const removeChat = async (id: string, purge: boolean, archive = false) => {
  const r = await removeSession(id, purge, archive);
  await unpin(id);
  return r;
};

export const pinsRoute = async (method: string, id: string | null): Promise<{ status: number; body: unknown }> => {
  if (method === 'GET') return { status: 200, body: await listPins() };
  if (method !== 'POST' && method !== 'DELETE') return { status: 405, body: { error: 'method not allowed' } };
  if (!id) return { status: 400, body: { error: 'id is required' } };
  await (method === 'POST' ? pin(id) : unpin(id));
  return { status: 200, body: { ok: true } };
};
