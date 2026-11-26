import { ARCHIVE_MS } from '../../../../shared/protocol.js';
import { listBin } from './bin.js';
import { listPins, removeChat } from './pins.js';
import { listSessions } from './sessions.js';
import { listLinks } from '../../session/subChats.js';
import { listSpawned } from '../../session/spawned.js';
import { rootOf, type SubLinks } from '../../../../shared/subChats.js';
import type { SpawnLink } from '../../../../shared/protocol.js';

type Chat = { sessionId: string; lastModified: number };

// Sessions of chats idle for ARCHIVE_MS, going by the latest activity of each row (a chat's sub-chats and the builds it
// started), where no session is kept.
export const idleChats = (list: Chat[], keep: Set<string>, links: SubLinks = {}, now = Date.now(), spawned: Record<string, SpawnLink> = {}) => {
  const groups = new Map<string, Chat[]>();
  for (const x of list) {
    const own = rootOf(links, x.sessionId);
    const root = spawned[own] ? rootOf(links, spawned[own].parent) : own;
    groups.set(root, [...(groups.get(root) ?? []), x]);
  }
  return [...groups].filter(([root, g]) => !keep.has(root) && !g.some((x) => keep.has(x.sessionId)) && g.every((x) => now - x.lastModified > ARCHIVE_MS))
    .flatMap(([, g]) => g.map((x) => x.sessionId));
};

// busy: session ids of open chats that are running or wait on you. close: closes an open chat before it is archived.
export async function archivePass(busy: Set<string>, close: (sessionId: string) => Promise<void>) {
  const [list, pins, bin, links, spawned] = await Promise.all([listSessions({ limit: 1000 }), listPins(), listBin(), listLinks(), listSpawned()]);
  for (const id of idleChats(list, new Set([...busy, ...pins, ...bin.map((b) => b.sessionId)]), links, Date.now(), spawned)) {
    await close(id);
    await removeChat(id, false, true);
  }
}

export function startAutoArchive(busy: () => Set<string>, close: (sessionId: string) => Promise<void>) {
  let running = false;
  const pass = () => {
    if (running) return;
    running = true;
    void archivePass(busy(), close).catch((e) => console.error('auto-archive failed:', e)).finally(() => { running = false; });
  };
  setTimeout(pass, 60_000).unref();
  setInterval(pass, 60 * 60_000).unref();
}
