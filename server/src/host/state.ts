import path from 'node:path';
import type { ServerMessage } from '../../../shared/protocol.js';
import type { AgentSession } from '../session/session.js';
import { socketPath } from './protocol.js';
import type { Saved } from './restore.js';

export const PORT = Number(process.env.PORT ?? 7777);
export const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
export const SOCK = socketPath(PORT);

export const apis = new Set<(v: unknown) => void>();
export const push = (v: unknown) => apis.forEach((send) => send(v));
export const broadcast = (m: ServerMessage, chat?: AgentSession) => push({ chat: chat?.id ?? null, m });

export const live = new Map<string, { chat: AgentSession; watcher: { close(): void } }>();

export const hub = {
  serving: false,
  counts: {} as Record<string, number>,
  desktopAt: 0,
  lastViewed: undefined as unknown as AgentSession,
  restarting: null as NodeJS.Timeout | null,
  // Saved chats not reopened yet; an exit during the restore keeps them for the next one.
  unrestored: [] as Saved[],
};

export const viewers = (chat: AgentSession) => hub.counts[chat.id] ?? 0;
export const bySession = (sessionId: string | null) => [...live.values()].find((l) => l.chat.state.session.sessionId === sessionId)?.chat;
export const get = (id: string) => {
  const chat = live.get(id)?.chat;
  if (!chat) throw new Error('This chat was closed');
  return chat;
};
