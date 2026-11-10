import os from 'node:os';
import path from 'node:path';
import { unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { AgentSession } from '../session/session.js';
import { writeJson, writeJsonSync } from '../json.js';
import { stoppedOf, type Saved } from './restore.js';
import { runs } from './listing.js';
import { SOCK, hub, live } from './state.js';

export const LAST = path.join(os.homedir(), '.agentview-last.json');
export const RESTORE = path.join(os.homedir(), '.agentview', 'restore.json');

let remembered = '';
export function remember(chat: AgentSession) {
  const sessionId = chat.state.session.sessionId;
  if (!sessionId || sessionId === remembered) return;
  remembered = sessionId;
  writeFile(LAST, JSON.stringify({ sessionId, cwd: chat.cwd })).catch(() => {});
}

export function saveAndExit() {
  // A host that never got the socket has nothing to save, and the socket and saved chats belong to the one that did.
  if (!hub.serving) process.exit(0);
  const open: Saved[] = [...live.values()].flatMap(({ chat }) => {
    const { sessionId, repeat, loop } = chat.state.session;
    const stopped = stoppedOf(chat.state.events, chat.driver.runningTasks?.() ?? [], chat.state.session.running);
    return sessionId ? [{ sessionId, crons: chat.crons, repeat, loop, queued: chat.queuedMessages, ...(stopped && { stopped }) }] : [];
  });
  const chats = [...open, ...hub.unrestored.filter((u) => !open.some((c) => c.sessionId === u.sessionId))];
  writeJsonSync(RESTORE, { view: hub.lastViewed?.state.session.sessionId, chats });
  runs.flush();
  try {
    unlinkSync(SOCK);
  } catch {}
  process.exit(0);
}

// A crash or kill skips saveAndExit, so a loop or build cycle is also written a second after it changes.
// Only the loop state goes in: queued messages and running work would be stale by the time of a crash.
const persisted = new WeakMap<AgentSession, string>();
let saveTimer: NodeJS.Timeout | null = null;
export function saveSoon() {
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    if (!hub.serving || hub.restarting) return;
    const chats: Saved[] = [...live.values()].flatMap(({ chat }) => {
      const { sessionId, repeat, loop } = chat.state.session;
      return sessionId && (repeat || loop.on || runs.jobOfSession(sessionId)) ? [{ sessionId, crons: [], repeat, loop }] : [];
    });
    const kept = hub.unrestored.filter((u) => !chats.some((c) => c.sessionId === u.sessionId));
    writeJson(RESTORE, { view: hub.lastViewed?.state.session.sessionId, chats: [...chats, ...kept] }).catch(() => {});
  }, 1000);
}

export function saveWhenLoopChanged(chat: AgentSession) {
  const { repeat, loop } = chat.state.session;
  const key = JSON.stringify([repeat, loop]);
  if (persisted.get(chat) === key) return;
  persisted.set(chat, key);
  saveSoon();
}
