import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { Provider, ServerMessage } from '../../../shared/protocol.js';
import type { AdvisorId } from '../../../shared/advisors.js';
import { getSessionInfo, listSessions } from '../agent/claude/sessions.js';
import { rememberAccount } from '../agent/claude/accounts.js';
import { isProvider, provider, providerOf, providerOptions, rememberProvider, transcriptPath } from '../agent/registry.js';
import { codexThread } from '../agent/codex/threads.js';
import { removeChat } from '../agent/claude/pins.js';
import { advisor, prepareAdvisor } from '../session/advisors.js';
import { AgentSession } from '../session/session.js';
import { READY } from '../session/runs.js';
import { UNATTENDED_INSTRUCTION } from '../session/prompts.js';
import { hasWork } from '../workspace/git.js';
import { runWorktree } from '../workspace/review.js';
import { removeRunWorktree } from '../workspace/worktrees.js';
import { errText } from '../../../shared/util.js';
import { loadSettings } from '../settings.js';
import { desktopActive } from '../presence.js';
import { notifyAway } from '../integrations/notify.js';
import { allowedFolder } from '../workspace/files.js';
import { announceApproval } from './approval.js';
import { applyInitialModel } from './initialModel.js';
import { watchFiles } from './watchFiles.js';
import { lastActive } from './summary.js';
import { broadcastLive, learning, runs, seenRunning, summaryOf } from './listing.js';
import { remember, saveSoon, saveWhenLoopChanged } from './persist.js';
import type { HostRequest } from './protocol.js';
import { PROJECT, broadcast, bySession, get, hub, live, push, viewers } from './state.js';

function onChatMessage(chat: AgentSession, m: ServerMessage) {
  broadcast(m, chat);
  const away = () => (viewers(chat) ? null : summaryOf(chat));
  notifyAway(m, away, () => desktopActive(hub.desktopAt), chat.roundNote);
  if (m.type === 'event' && m.event.kind === 'agent') void announceApproval(chat, m.event, away, (a) => broadcast(a, chat));
  if (m.type === 'session' && chat.state.session.sessionId) {
    rememberAccount(chat.state.session.sessionId, chat.state.session.account);
    rememberProvider(chat.state.session.sessionId, chat.driver.provider);
  }
  if (m.type === 'session' && chat === hub.lastViewed) remember(chat);
  if (m.type === 'session') saveWhenLoopChanged(chat);
  const woke = seenRunning(chat, chat.state.session.running);
  if (woke || (m.type === 'event' ? m.event.kind === 'user' : m.type !== 'append')) broadcastLive();
}

async function defaultChoice(): Promise<Provider> {
  const { defaultProvider } = loadSettings();
  if (!isProvider(defaultProvider) || defaultProvider === 'claude') return 'claude';
  return (await providerOptions()).some((o) => o.id === defaultProvider && o.enabled) ? defaultProvider : 'claude';
}

// A chat is unattended while it has a job run that is not done, also after a restart.
const unattendedSession = (sessionId?: string) => Boolean(runs.jobOfSession(sessionId));

export async function createChat(cwd: string, resume?: string, title = '', fork = false, choice?: Provider, unattended = unattendedSession(resume)) {
  // The account a chat starts on depends on the limit marks, so a wrong one is cleared first.
  const p = provider(isProvider(choice) ? choice : resume ? providerOf(resume) : await defaultChoice());
  await p.verifyLimits();
  const chat = new AgentSession(cwd, p.driver(cwd, resume, fork, unattended), resume ?? null);
  chat.runs = runs;
  chat.transcriptPath = transcriptPath;
  chat.title = title;
  chat.onIdle = () => learning.later(chat);
  const job = runs.jobOfSession(resume);
  if (job) runs.update(job.id, { chatId: chat.id });
  chat.onJobTurn = (id, failed) => void reviewJob(chat, id, failed);
  chat.startChat = (dir, text) => prompt(dir, text, undefined, true);
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

export async function closeByUser(chat: AgentSession, fallbackCwd = chat.cwd) {
  const others = [...live.values()].map((l) => l.chat).filter((c) => c !== chat);
  const next = others.sort((a, b) => lastActive(b) - lastActive(a))[0] ?? (await createChat(fallbackCwd));
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
  const info = (await codexThread(sessionId)) ?? (await getSessionInfo(sessionId));
  if (!info) throw new Error('Session not found');
  if (!info.cwd) throw new Error('This session has no folder recorded, so it cannot be resumed');
  if (!(await isDir(info.cwd))) throw new Error(`Folder no longer exists: ${info.cwd}`);
  const dir = path.resolve(info.cwd);
  if (dir !== PROJECT && !allowedFolder(dir)) throw new Error(`Not a workspace folder: ${info.cwd}`);
  return createChat(dir, sessionId, info.summary);
}

// One live chat per advisor: its open chat, else its latest saved one, else a new one on its model. Fresh replaces an idle
// open chat with a new one; two opens at once share one chat.
const advisorOpening = new Map<AdvisorId, Promise<AgentSession>>();
export function openAdvisor(id: AdvisorId, fresh: boolean) {
  const pending = advisorOpening.get(id) ?? startAdvisor(id, fresh).finally(() => advisorOpening.delete(id));
  advisorOpening.set(id, pending);
  return pending;
}

async function startAdvisor(id: AdvisorId, fresh: boolean) {
  const a = advisor(id);
  if (!a) throw new Error(`Unknown advisor: ${id}`);
  const dir = await prepareAdvisor(a);
  const open = [...live.values()].map((l) => l.chat).find((c) => c.cwd === dir);
  if (open && !fresh) return open;
  if (open && (open.state.session.running || open.state.pending.length)) throw new Error(`${a.name} is still working; stop it first or wait`);
  const last = fresh ? undefined : (await listSessions({ dir, limit: 1 }))[0];
  if (last) return openSaved(last.sessionId);
  const chat = await createChat(dir, undefined, '', false, 'claude');
  applyInitialModel(chat, a.model);
  if (open) closeChat(open);
  return chat;
}

export async function newChat(cwd: string, from: AgentSession | undefined, fork?: string, choice?: Provider) {
  const dir = path.resolve(cwd);
  if (dir !== from?.cwd && dir !== PROJECT && !allowedFolder(dir)) throw new Error(`Not a workspace folder: ${dir}`);
  if (!(await isDir(dir))) throw new Error(`Folder no longer exists: ${dir}`);
  return fork ? createChat(dir, fork, from?.title ?? '', true) : createChat(dir, undefined, '', false, choice);
}

export async function prompt(cwd: string, text: string, from?: string, fresh = false, choice: Provider = 'claude', model?: string) {
  const reuse = fresh ? undefined : [...live.values()].map((l) => l.chat).filter((c) => c.cwd === cwd && c.driver.provider === choice && !c.state.session.running && !c.state.pending.length).sort((a, b) => lastActive(b) - lastActive(a))[0];
  const chat = reuse ?? (from ? await newChat(cwd, get(from), undefined, choice) : await createChat(cwd, undefined, '', false, choice));
  if (!reuse) applyInitialModel(chat, model);
  void chat.prompt(text);
  return chat.id;
}

// A scheduled coding job: a claude chat in a worktree the server made, with a run that holds the job's branch and worktree.
export async function jobChat(job: Extract<HostRequest, { op: 'job' }>) {
  const chat = await createChat(job.cwd, undefined, job.title, false, 'claude', true);
  runs.start({ kind: 'job', sessionId: '', chatId: chat.id, title: job.title, what: job.prompt, provider: 'claude', jobId: job.jobId, branch: job.branch, repo: job.repo, worktree: job.cwd, paseo: job.paseo });
  void chat.prompt(`${job.prompt}\n\n${UNATTENDED_INSTRUCTION}`);
  return chat.id;
}

// A job turn ended: a run with changes waits for review, an empty one is cleaned up, or ends Failed when its turn failed.
export async function reviewJob(chat: AgentSession, id: string, failed: boolean) {
  const run = runs.get(id);
  if (!run) return;
  try {
    const { cwd, env } = await runWorktree(run);
    if (await hasWork(cwd, env)) return runs.update(id, { state: 'paused', why: READY, review: 'pending' });
    if (failed) return runs.end(id, 'Failed');
    await dropJobRun(id, 'No changes');
  } catch (err) {
    console.error(`could not review job run ${id}: ${errText(err)}`);
    runs.end(id, errText(err).split('\n')[0]);
  }
}

// Ends a job run and removes its chat and worktree. The run ends first, since closing the chat would end it as closed. The worktree goes last, once no chat has it open, and a replacement chat opens in the main checkout.
export async function dropJobRun(id: string, why: string) {
  const run = runs.get(id);
  if (run?.kind !== 'job') throw new Error('The run is not open');
  if (run.state !== 'done') {
    runs.update(id, { review: undefined });
    runs.end(id, why);
  }
  const chat = live.get(run.chatId)?.chat ?? (run.sessionId ? bySession(run.sessionId) : undefined);
  if (chat) await closeByUser(chat, run.repo);
  if (run.sessionId) await removeChat(run.sessionId, false, true);
  await removeRunWorktree(run);
}

export function endRun(id: string, why: string, pr?: string) {
  const run = runs.get(id);
  if (run?.kind !== 'job' || run.state === 'done') throw new Error('The run is not open');
  if (pr && run.review !== 'pending') throw new Error('The run is not waiting for review');
  runs.update(id, { review: undefined, ...(pr && { pr }) });
  runs.end(id, why);
}

// The note goes to the run's chat, which is reopened when it was closed.
export async function reviseRun(id: string, text: string) {
  const run = runs.get(id);
  if (run?.review !== 'pending') throw new Error('The run is not waiting for review');
  const chat = await openSaved(run.sessionId);
  runs.update(id, { chatId: chat.id, state: 'running', why: '', review: undefined });
  void chat.prompt(text);
}
