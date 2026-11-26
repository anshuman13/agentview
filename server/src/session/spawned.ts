import os from 'node:os';
import path from 'node:path';
import type { SpawnLink } from '../../../shared/protocol.js';
import { jsonFile } from '../json.js';

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
