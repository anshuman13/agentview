import os from 'node:os';
import path from 'node:path';
import { jsonFile, failed } from '../../json.js';

const KEEP = 500;
const KEY_MAX = 500;

const store = jsonFile<string[]>(path.join(os.homedir(), '.agentview', 'questions-resolved.json'), []);

export const resolvedRoute = async (method: string, key: string | null): Promise<{ status: number; body: unknown }> => {
  if (method === 'GET') return { status: 200, body: await store.read() };
  if (method !== 'POST') return failed(405, 'method not allowed');
  if (!key) return failed(400, 'key is required');
  if (key.length > KEY_MAX) return failed(400, 'key is too long');
  await store.update((list) => (list.includes(key) ? list : [key, ...list].slice(0, KEEP)));
  return { status: 200, body: { ok: true } };
};
