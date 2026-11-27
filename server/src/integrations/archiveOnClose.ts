import { existsSync } from 'node:fs';
import { jsonFile } from '../json.js';
import { repoKey } from './github.js';

type Entry = { cwd: string; number: number; chats: string[] };
type Gh = (cwd: string, ...args: string[]) => Promise<string>;
type Deps = {
  gh: Gh;
  file: string;
  // Session ids of the chats whose PR is this one.
  linked: (cwd: string, number: number) => string[];
  // Pinned chats and chats that are running or wait on you.
  keep: () => Promise<Set<string>>;
  archive: (sessionId: string) => Promise<void>;
  exists?: (cwd: string) => boolean;
};

const same = (e: Entry, cwd: string, number: number) => repoKey(e.cwd) === repoKey(cwd) && e.number === number;

// Chats linked to a PR when it was armed or when it merged or closed, minus the ones kept.
export const chatsToArchive = (stored: string[], now: string[], keep: Set<string>) => [...new Set([...stored, ...now])].filter((id) => !keep.has(id));

// Moves a PR's chats to the bin once the PR merges or closes, for the PRs this is turned on for.
export function createArchiveOnClose({ gh, file, linked, keep, archive, exists = existsSync }: Deps) {
  const store = jsonFile<Entry[]>(file, []);
  const drop = (e: Entry) => store.update((cur) => cur.filter((x) => !same(x, e.cwd, e.number)));

  async function turn(cwd: string, number: number, on: boolean) {
    if (!on) return void (await store.update((cur) => cur.filter((x) => !same(x, cwd, number))));
    const chats = linked(cwd, number);
    await store.update((cur) => (cur.some((x) => same(x, cwd, number)) ? cur : [...cur, { cwd, number, chats }]));
  }

  async function check(e: Entry) {
    if (!exists(e.cwd)) return void (await drop(e));
    let state: string;
    try {
      state = JSON.parse(await gh(e.cwd, 'pr', 'view', String(e.number), '--json', 'state')).state;
    } catch {
      return;
    }
    if (state === 'OPEN') {
      const now = linked(e.cwd, e.number).filter((id) => !e.chats.includes(id));
      if (now.length) await store.update((cur) => cur.map((x) => (same(x, e.cwd, e.number) ? { ...x, chats: [...x.chats, ...now] } : x)));
      return;
    }
    const kept = await keep();
    for (const id of chatsToArchive(e.chats, linked(e.cwd, e.number), kept)) await archive(id).catch((err) => console.error('archive on close:', err));
    await drop(e);
  }

  const poll = async () => void (await Promise.all((await store.read()).map(check)));

  const armed = async (cwd: string) => new Set((await store.read()).filter((e) => repoKey(e.cwd) === repoKey(cwd)).map((e) => e.number));

  const start = () => setInterval(() => void poll().catch(() => {}), 60_000).unref();

  return { turn, poll, armed, start };
}

export type ArchiveOnClose = ReturnType<typeof createArchiveOnClose>;
