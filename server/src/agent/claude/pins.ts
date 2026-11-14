import os from 'node:os';
import path from 'node:path';
import { jsonFile, failed } from '../../json.js';
import { removeSession } from './bin.js';
import { unseen } from './seen.js';

const store = jsonFile<string[]>(path.join(os.homedir(), '.agentview', 'pins.json'), []);

export const listPins = () => store.read();

export const pin = async (id: string) => {
  await store.update((list) => (list.includes(id) ? list : [id, ...list]));
};

export const unpin = async (id: string) => {
  await store.update((list) => (list.includes(id) ? list.filter((x) => x !== id) : list));
};

export const removeChat = async (id: string, purge: boolean, archive = false) => {
  const r = await removeSession(id, purge, archive);
  await unpin(id);
  await unseen(id);
  return r;
};

export const pinsRoute = async (method: string, id: string | null): Promise<{ status: number; body: unknown }> => {
  if (method === 'GET') return { status: 200, body: await listPins() };
  if (method !== 'POST' && method !== 'DELETE') return failed(405, 'method not allowed');
  if (!id) return failed(400, 'id is required');
  await (method === 'POST' ? pin(id) : unpin(id));
  return { status: 200, body: { ok: true } };
};
