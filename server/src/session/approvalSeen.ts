import path from 'node:path';
import { jsonFile } from '../json.js';
import { buildsRoot } from './builds.js';

const KEEP = 200;

const stores = new Map<string, ReturnType<typeof jsonFile<string[]>>>();

// True the first time a key is added; the newest 200 keys stay in a file so a restart does not forget them.
export async function firstSeen(key: string) {
  const file = path.join(buildsRoot(), 'approval-seen.json');
  if (!stores.has(file)) stores.set(file, jsonFile<string[]>(file, []));
  let fresh = false;
  await stores.get(file)!.update((cur) => {
    fresh = !cur.includes(key);
    return fresh ? [...cur, key].slice(-KEEP) : cur;
  });
  return fresh;
}
