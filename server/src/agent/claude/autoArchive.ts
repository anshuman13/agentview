import { ARCHIVE_MS } from '../../../../shared/protocol.js';
import { listBin } from './bin.js';
import { listPins, removeChat } from './pins.js';
import { listSessions } from './sessions.js';

type Chat = { sessionId: string; lastModified: number };

// Unpinned chats idle for ARCHIVE_MS that are not running or waiting on you.
export const idleChats = (list: Chat[], keep: Set<string>, now = Date.now()) =>
  list.filter((x) => now - x.lastModified > ARCHIVE_MS && !keep.has(x.sessionId)).map((x) => x.sessionId);

// busy: session ids of open chats that are running or wait on you. close: closes an open chat before it is archived.
export async function archivePass(busy: Set<string>, close: (sessionId: string) => Promise<void>) {
  const [list, pins, bin] = await Promise.all([listSessions({ limit: 300 }), listPins(), listBin()]);
  for (const id of idleChats(list, new Set([...busy, ...pins, ...bin.map((b) => b.sessionId)]))) {
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
