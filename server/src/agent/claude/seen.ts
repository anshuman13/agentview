import os from 'node:os';
import path from 'node:path';
import { jsonFile } from '../../json.js';

const store = jsonFile<Record<string, number>>(path.join(os.homedir(), '.agentview', 'seen.json'), {});

export const listSeen = () => store.read();

export const markSeen = async (id: string) => {
  await store.update((map) => ({ ...map, [id]: Date.now() }));
};

export const unseen = async (id: string) => {
  await store.update((map) => {
    if (!(id in map)) return map;
    const { [id]: _, ...rest } = map;
    return rest;
  });
};

export const seenRoute = async (method: string, id: string | null): Promise<{ status: number; body: unknown }> => {
  if (method === 'GET') return { status: 200, body: await listSeen() };
  if (method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  if (!id) return { status: 400, body: { error: 'id is required' } };
  await markSeen(id);
  return { status: 200, body: { ok: true } };
};
