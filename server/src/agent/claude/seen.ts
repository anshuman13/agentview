import os from 'node:os';
import path from 'node:path';
import { jsonFile, failed } from '../../json.js';

const store = jsonFile<Record<string, number>>(path.join(os.homedir(), '.agentview', 'seen.json'), {});

const listSeen = () => store.read();

// Unread sets the time to 0, so any activity in the chat shows it as Done again.
export const markSeen = async (id: string, unread = false) => {
  await store.update((map) => ({ ...map, [id]: unread ? 0 : Date.now() }));
};

export const unseen = async (id: string) => {
  await store.update((map) => {
    if (!(id in map)) return map;
    const { [id]: _, ...rest } = map;
    return rest;
  });
};

export const seenRoute = async (method: string, id: string | null, unread = false): Promise<{ status: number; body: unknown }> => {
  if (method === 'GET') return { status: 200, body: await listSeen() };
  if (method !== 'POST') return failed(405, 'method not allowed');
  if (!id) return failed(400, 'id is required');
  await markSeen(id, unread);
  return { status: 200, body: { ok: true } };
};
