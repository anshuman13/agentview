import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { ServerMessage } from '../../../shared/protocol.js';
import { getSessionInfo } from '../agent/claude/sessions.js';
import { rememberAccount } from '../agent/claude/accounts.js';
import { provider, providerOf, rememberProvider } from '../agent/registry.js';
import { AgentSession } from '../session/session.js';
import { desktopActive } from '../presence.js';
import { notifyAway } from '../integrations/notify.js';
import { allowedFolder } from '../workspace/files.js';
import { watchFiles } from './watchFiles.js';
import { lastActive } from './summary.js';
import { broadcastLive, learning, runs, seenRunning, summaryOf } from './listing.js';
import { remember, saveSoon, saveWhenLoopChanged } from './persist.js';
import { PROJECT, broadcast, bySession, get, hub, live, push, viewers } from './state.js';

function onChatMessage(chat: AgentSession, m: ServerMessage) {
  broadcast(m, chat);
  notifyAway(m, () => (viewers(chat) ? null : summaryOf(chat)), () => desktopActive(hub.desktopAt), chat.roundNote);
  if (m.type === 'session' && chat.state.session.sessionId) {
    rememberAccount(chat.state.session.sessionId, chat.state.session.account);
    rememberProvider(chat.state.session.sessionId, chat.driver.provider);
  }
  if (m.type === 'session' && chat === hub.lastViewed) remember(chat);
  if (m.type === 'session') saveWhenLoopChanged(chat);
  const woke = seenRunning(chat, chat.state.session.running);
  if (woke || (m.type === 'event' ? m.event.kind === 'user' : m.type !== 'append')) broadcastLive();
}

export async function createChat(cwd: string, resume?: string, title = '', fork = false) {
  // The account a chat starts on depends on the limit marks, so a wrong one is cleared first.
  const p = provider(providerOf(resume));
  await p.verifyLimits();
  const chat = new AgentSession(cwd, p.driver(cwd, resume, fork), resume ?? null);
  chat.runs = runs;
  chat.title = title;
  chat.onIdle = () => learning.later(chat);
  await chat.loadHistory();
  await chat.hooks.load();
  chat.onMessage((m) => onChatMessage(chat, m));
  if (!resume || fork) chat.start();
  live.set(chat.id, { chat, watcher: watchFiles(cwd, (rel) => chat.fileChangedExternally(rel)) });
  broadcastLive();
  return chat;
}

export function closeChat(chat: AgentSession) {
  learning.forget(chat.id);
  chat.close();
  seenRunning(chat, false);
  live.get(chat.id)?.watcher.close();
  live.delete(chat.id);
  saveSoon();
  push({ closed: chat.id });
  broadcastLive();
}

export async function closeByUser(chat: AgentSession) {
  const others = [...live.values()].map((l) => l.chat).filter((c) => c !== chat);
  const next = others.sort((a, b) => lastActive(b) - lastActive(a))[0] ?? (await createChat(chat.cwd));
  if (hub.lastViewed === chat) hub.lastViewed = next;
  closeChat(chat);
  return next.id;
}

const isDir = (dir: string) => stat(dir).then((s) => s.isDirectory()).catch(() => false);

// Two opens of one session at once (phone and desktop) share one chat.
const opening = new Map<string, Promise<AgentSession>>();
export function openSaved(sessionId: string) {
  const open = bySession(sessionId);
  if (open) return Promise.resolve(open);
  const pending = opening.get(sessionId) ?? resumeSaved(sessionId).finally(() => opening.delete(sessionId));
  opening.set(sessionId, pending);
  return pending;
}

async function resumeSaved(sessionId: string) {
  const info = await getSessionInfo(sessionId);
  if (!info) throw new Error('Session not found');
  if (!info.cwd) throw new Error('This session has no folder recorded, so it cannot be resumed');
  if (!(await isDir(info.cwd))) throw new Error(`Folder no longer exists: ${info.cwd}`);
  const dir = path.resolve(info.cwd);
  if (dir !== PROJECT && !allowedFolder(dir)) throw new Error(`Not a workspace folder: ${info.cwd}`);
  return createChat(dir, sessionId, info.summary);
}

export async function newChat(cwd: string, from: AgentSession, fork?: string) {
  const dir = path.resolve(cwd);
  if (dir !== from.cwd && dir !== PROJECT && !allowedFolder(dir)) throw new Error(`Not a workspace folder: ${dir}`);
  if (!(await isDir(dir))) throw new Error(`Folder no longer exists: ${dir}`);
  return fork ? createChat(dir, fork, from.title, true) : createChat(dir);
}

export async function prompt(cwd: string, text: string, from?: string, fresh = false) {
  const reuse = fresh ? undefined : [...live.values()].map((l) => l.chat).filter((c) => c.cwd === cwd && !c.state.session.running && !c.state.pending.length).sort((a, b) => lastActive(b) - lastActive(a))[0];
  const chat = reuse ?? (from ? await newChat(cwd, get(from)) : await createChat(cwd));
  void chat.prompt(text);
  return chat.id;
}
