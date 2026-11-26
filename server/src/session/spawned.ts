import os from 'node:os';
import path from 'node:path';
import type { SpawnLink } from '../../../shared/protocol.js';
import { jsonFile } from '../json.js';
import { groupOf } from './subChats.js';

type Spawned = Record<string, SpawnLink>;

const store = jsonFile<Spawned>(path.join(os.homedir(), '.agentview', 'spawned.json'), {});

export const listSpawned = () => store.read();

// Records that child was started by parent. A child never gets a second parent and never links to itself.
export const linkSpawned = (child: string, parent: string, at = Date.now()) =>
  store.update((links) => (links[child] || child === parent ? links : { ...links, [child]: { parent, kind: 'build', at } }));

// Chats parent started, oldest first.
export const spawnedOf = async (parent: string) =>
  Object.entries(await store.read())
    .filter(([, l]) => l.parent === parent)
    .sort(([, a], [, b]) => a.at - b.at)
    .map(([child]) => child);

// Every session of id's row: its chat (groupOf), then the chats of the builds any of them started, each with its own
// sub-chats. Archive and Restore move them together.
export async function rowOf(id: string) {
  const own = await groupOf(id);
  const links = await store.read();
  const builds = Object.entries(links).filter(([child, l]) => own.includes(l.parent) && !own.includes(child)).sort(([, a], [, b]) => a.at - b.at);
  const rest = await Promise.all(builds.map(([child]) => groupOf(child)));
  return [...new Set([...own, ...rest.flat()])];
}
