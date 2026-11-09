import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, watch, type FSWatcher } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { getSessionInfo } from '../agent/claude/sessions.js';
import { claudeSession } from '../agent/claude/driver.js';
import { loggedInAccounts, rememberAccount, verifyLimit } from '../agent/claude/accounts.js';
import { configDef } from '../agent/claude/mcp.js';
import type { AgentSession } from '../session/session.js';
import { desktopActive } from '../presence.js';
import { notifyAway, notifyRunEnded, notifyStall, stallWatch } from '../integrations/notify.js';
import { allowedFolder } from '../workspace/files.js';
import { parseTries, startTries, TRIES_USAGE } from '../workspace/tries.js';
import { ownProfile } from '../chrome/chrome.js';
import { MCP_BAD, type ChatRun, type ClientMessage, type LiveChat, type ServerMessage } from '../../../shared/protocol.js';
import { replyLine, sumEdits } from '../../../shared/edits.js';
import { errText } from '../../../shared/util.js';
import { applyInitialModel } from './initialModel.js';
import { sendWhenChanged } from './changed.js';
import { costsOf, modelField } from './summaryCache.js';
import { busy, runningAgents, parseSaved, stoppedOf, type Saved } from './restore.js';
import { codeHash } from './hash.js';
import { Runs } from '../session/runs.js';
import { lines, socketPath, type Hello, type HostRequest } from './protocol.js';
import { readJson, writeJson, writeJsonSync } from '../json.js';

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const SOCK = socketPath(PORT);
const CODE = () => codeHash(fileURLToPath(import.meta.url), [path.resolve(here, '../../package.json')]);
const BOOT_CODE = CODE();

if (ownProfile()) {
  process.env.BROWSER = path.resolve(here, '../../browser.sh');
  process.env.AGENTVIEW_PORT = String(PORT);
}

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.venv|venv|__pycache__|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.tox)(\/|$)/;
const LAST = path.join(os.homedir(), '.agentview-last.json');
const RESTORE = path.join(os.homedir(), '.agentview', 'restore.json');
const RUNS = path.join(os.homedir(), '.agentview', 'runs.json');
const IDLE_MS = 10 * 60 * 1000;
const ORPHAN_MS = 5 * 60 * 1000;

process.on('uncaughtException', (err) => console.error('uncaught:', err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err));

const served = () =>
  new Promise<boolean>((ok) => {
    const probe = net.connect(SOCK).on('connect', () => { probe.destroy(); ok(true); }).on('error', () => ok(false));
  });
// Another host already serving this port's socket keeps it; this one leaves.
if (await served()) process.exit(0);

const apis = new Set<(v: unknown) => void>();
const push = (v: unknown) => apis.forEach((send) => send(v));
const broadcast = (m: ServerMessage, chat?: AgentSession) => push({ chat: chat?.id ?? null, m });

let serving = false;
const live = new Map<string, { chat: AgentSession; watcher: { close(): void } }>();
let counts: Record<string, number> = {};
let desktopAt = 0;
let lastViewed: AgentSession;
let restarting: NodeJS.Timeout | null = null;

const viewers = (chat: AgentSession) => counts[chat.id] ?? 0;
const bySession = (sessionId: string | null) => [...live.values()].find((l) => l.chat.state.session.sessionId === sessionId)?.chat;
const lastActive = (chat: AgentSession) => chat.state.events.at(-1)?.at ?? chat.created;
const get = (id: string) => {
  const chat = live.get(id)?.chat;
  if (!chat) throw new Error('This chat was closed');
  return chat;
};

const runs = new Runs(RUNS, () => broadcastLive(), (run) => {
  const chat = live.get(run.chatId)?.chat;
  if (run.why === 'you stopped it' || (chat && viewers(chat))) return;
  notifyRunEnded(run, chat ? path.basename(chat.cwd) : '', !desktopActive(desktopAt));
});

const stalls = stallWatch((id) => {
  const l = live.get(id);
  if (!l) return;
  notifyStall(summary(l.chat));
  broadcastLive();
});

// sumEdits walks every event; tool_use inputs and results are never edited in place, so identity + length is a safe key.
const editsCache = new WeakMap<AgentSession, { events: unknown[]; length: number; edits: ReturnType<typeof sumEdits> }>();
function editsOf(chat: AgentSession) {
  const { events } = chat.state;
  const hit = editsCache.get(chat);
  if (hit?.events === events && hit.length === events.length) return hit.edits;
  const edits = sumEdits(events);
  editsCache.set(chat, { events, length: events.length, edits });
  return edits;
}

function summary(chat: AgentSession): LiveChat {
  const s = chat.state;
  const agentList = runningAgents(chat);
  const firstPrompt = s.events.find((e) => e.kind === 'user');
  const { cost, spend } = costsOf(s.events, new Date().setHours(0, 0, 0, 0));
  return {
    id: chat.id,
    sessionId: s.session.sessionId,
    cwd: chat.cwd,
    title: chat.title || (firstPrompt?.kind === 'user' ? firstPrompt.text.split('\n')[0].slice(0, 80) : 'New chat'),
    running: s.session.running,
    agents: agentList.length,
    ...(agentList.length > 0 && { agentList }),
    pending: s.pending.length,
    status: s.status,
    lastActive: lastActive(chat),
    mcpFailed: s.session.mcp.filter((m) => MCP_BAD.includes(m.status)).length,
    cost,
    ...(Object.keys(spend.week).length > 0 && { spend }),
    stalled: stalls.stalled(chat.id),
    ...(chat.failed && { failed: true }),
    ...modelField(s.session.model),
    last: replyLine(s.events),
    edits: editsOf(chat),
    ...(s.session.pr && { pr: s.session.pr }),
    ...runField(runs.activeFor(chat.id)),
  };
}

function runField(run: ChatRun | undefined): Pick<LiveChat, 'run'> {
  if (!run) return {};
  const last = run.rounds.at(-1);
  return { run: { id: run.id, kind: run.kind, state: run.state, ...(run.why && { why: run.why }), nextAt: run.nextAt, round: run.round, ...(last && { outcome: last.outcome, line: last.line }) } };
}

const liveList = () => [...live.values()].map((l) => summary(l.chat)).sort((a, b) => b.lastActive - a.lastActive);
let liveTimer: NodeJS.Timeout | null = null;
const sendLive = sendWhenChanged((chats: LiveChat[]) => broadcast({ type: 'live', chats }));
const sendRuns = sendWhenChanged((list: ChatRun[]) => broadcast({ type: 'runs', runs: list }));
function broadcastLive() {
  liveTimer ??= setTimeout(() => {
    liveTimer = null;
    for (const { chat } of live.values()) chat.watchHistory(viewers(chat) > 0);
    sendLive(liveList());
    sendRuns(runs.list());
  }, 100);
}

async function createChat(cwd: string, resume?: string, title = '', fork = false) {
  // The account a chat starts on depends on the limit marks, so a wrong one is cleared first.
  await Promise.all(loggedInAccounts().map((a) => verifyLimit(a)));
  const chat = claudeSession(cwd, resume, fork);
  chat.runs = runs;
  chat.title = title;
  await chat.loadHistory();
  chat.onMessage((m) => {
    broadcast(m, chat);
    notifyAway(m, () => (viewers(chat) ? null : summary(chat)), () => desktopActive(desktopAt), chat.roundNote);
    if (m.type === 'session' && chat.state.session.sessionId) rememberAccount(chat.state.session.sessionId, chat.state.session.account);
    if (m.type === 'session' && chat === lastViewed) remember(chat);
    if (m.type === 'session') {
      const { repeat, loop } = chat.state.session;
      const key = JSON.stringify([repeat, loop]);
      if (persisted.get(chat) !== key) {
        persisted.set(chat, key);
        saveSoon();
      }
    }
    const woke = stalls.seen(chat.id, chat.state.session.running);
    if (woke || (m.type === 'event' ? m.event.kind === 'user' : m.type !== 'append')) broadcastLive();
  });
  if (!resume || fork) chat.start();
  live.set(chat.id, { chat, watcher: watchFiles(cwd, (rel) => chat.fileChangedExternally(rel)) });
  broadcastLive();
  return chat;
}

function closeChat(chat: AgentSession) {
  chat.close();
  stalls.seen(chat.id, false);
  live.get(chat.id)?.watcher.close();
  live.delete(chat.id);
  saveSoon();
  push({ closed: chat.id });
  broadcastLive();
}

async function closeByUser(chat: AgentSession) {
  const others = [...live.values()].map((l) => l.chat).filter((c) => c !== chat);
  const next = others.sort((a, b) => lastActive(b) - lastActive(a))[0] ?? (await createChat(chat.cwd));
  if (lastViewed === chat) lastViewed = next;
  closeChat(chat);
  return next.id;
}

const idle = (chat: AgentSession) => !busy(chat) && chat.crons.length === 0 && !chat.state.session.repeat && chat.state.pending.length === 0 && viewers(chat) === 0 && chat !== lastViewed;

let orphaned = 0;
setInterval(() => {
  for (const { chat } of live.values()) if (idle(chat) && Date.now() - lastActive(chat) > IDLE_MS) closeChat(chat);
  // With no API server for a while (AgentView quit) and nothing running, save the chats and leave.
  orphaned = apis.size ? 0 : orphaned || Date.now();
  if (orphaned && Date.now() - orphaned > ORPHAN_MS && ![...live.values()].some(({ chat }) => busy(chat))) saveAndExit();
}, 60_000);

// One recursive watcher per folder, shared by every chat in it and closed with the last one.
const folders = new Map<string, { listeners: Set<(rel: string) => void>; watcher: FSWatcher }>();

function watchFiles(cwd: string, onChange: (rel: string) => void) {
  let folder = folders.get(cwd);
  if (!folder) {
    const listeners = new Set<(rel: string) => void>();
    const timers = new Map<string, NodeJS.Timeout>();
    const watcher = watch(cwd, { recursive: true }, (_, rel) => {
      if (!rel || IGNORED.test(rel)) return;
      clearTimeout(timers.get(rel));
      timers.set(rel, setTimeout(() => {
        timers.delete(rel);
        stat(path.join(cwd, rel)).then((s) => s.isFile() && listeners.forEach((l) => l(rel))).catch(() => {});
      }, 200));
    }).on('error', (err) => {
      console.error(`watcher: ${String(err)}`);
      watcher.close();
      if (folders.get(cwd)?.watcher === watcher) folders.delete(cwd);
    });
    folder = { listeners, watcher };
    folders.set(cwd, folder);
  }
  const { listeners, watcher } = folder;
  listeners.add(onChange);
  return {
    close() {
      if (!listeners.delete(onChange) || listeners.size) return;
      watcher.close();
      folders.delete(cwd);
    },
  };
}

const isDir = (dir: string) => stat(dir).then((s) => s.isDirectory()).catch(() => false);

// Two opens of one session at once (phone and desktop) share one chat.
const opening = new Map<string, Promise<AgentSession>>();
function openSaved(sessionId: string) {
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

async function newChat(cwd: string, from: AgentSession, fork?: string) {
  const dir = path.resolve(cwd);
  if (dir !== from.cwd && dir !== PROJECT && !allowedFolder(dir)) throw new Error(`Not a workspace folder: ${dir}`);
  if (!(await isDir(dir))) throw new Error(`Folder no longer exists: ${dir}`);
  return fork ? createChat(dir, fork, from.title, true) : createChat(dir);
}

let remembered = '';
function remember(chat: AgentSession) {
  const sessionId = chat.state.session.sessionId;
  if (!sessionId || sessionId === remembered) return;
  remembered = sessionId;
  writeFile(LAST, JSON.stringify({ sessionId, cwd: chat.cwd })).catch(() => {});
}

// Saved chats not reopened yet; an exit during the restore keeps them for the next one.
let unrestored: Saved[] = [];

function saveAndExit() {
  // A host that never got the socket has nothing to save, and the socket and saved chats belong to the one that did.
  if (!serving) process.exit(0);
  const open: Saved[] = [...live.values()].flatMap(({ chat }) => {
    const { sessionId, repeat, loop } = chat.state.session;
    const stopped = stoppedOf(chat.state.events, chat.driver.runningTasks?.() ?? [], chat.state.session.running);
    return sessionId ? [{ sessionId, crons: chat.crons, repeat, loop, queued: chat.queuedMessages, ...(stopped && { stopped }) }] : [];
  });
  const chats = [...open, ...unrestored.filter((u) => !open.some((c) => c.sessionId === u.sessionId))];
  writeJsonSync(RESTORE, { view: lastViewed?.state.session.sessionId, chats });
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
function saveSoon() {
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    if (!serving || restarting) return;
    const chats: Saved[] = [...live.values()].flatMap(({ chat }) => {
      const { sessionId, repeat, loop } = chat.state.session;
      return sessionId && (repeat || loop.on) ? [{ sessionId, crons: [], repeat, loop }] : [];
    });
    const kept = unrestored.filter((u) => !chats.some((c) => c.sessionId === u.sessionId));
    writeJson(RESTORE, { view: lastViewed?.state.session.sessionId, chats: [...chats, ...kept] }).catch(() => {});
  }, 1000);
}

// Only when the host's own code changed on disk, unless forced: restarting the host ends running Claude processes.
function restart(now: boolean, force: boolean) {
  if (!force && CODE() === BOOT_CODE) return false;
  if (now) return saveAndExit();
  if (restarting) return true;
  broadcast({ type: 'restarting' });
  for (const { chat } of live.values()) chat.holdRepeat();
  // Background agents and tasks live in the Claude process, so they hold the restart too.
  // A turn that never ends (a card nobody answers) must not hold the restart and every loop for good.
  const deadline = Date.now() + 10 * 60_000;
  restarting = setInterval(() => {
    if (Date.now() > deadline || ![...live.values()].some(({ chat }) => busy(chat))) saveAndExit();
  }, 1000);
  return true;
}

process.on('SIGTERM', saveAndExit);
process.on('SIGINT', saveAndExit);

async function restore() {
  const saved = await readFile(RESTORE, 'utf8').then(parseSaved).catch(() => null);
  if (!saved) return null;
  unrestored = saved.chats.slice();
  await Promise.all(saved.chats.map(async (s) => {
    const chat = await openSaved(s.sessionId).catch((err) => {
      console.error(`could not reopen chat ${s.sessionId}: ${errText(err)}`);
      return null;
    });
    if (!chat) return;
    unrestored = unrestored.filter((u) => u !== s);
    if (s.crons.length) chat.restoreCrons(s.crons);
    if (s.loop) chat.restoreLoop(s.loop);
    if (s.repeat) chat.resumeRepeat(s.repeat);
    if (s.stopped) chat.resumeStopped(s.stopped);
    for (const q of s.queued ?? []) void chat.prompt(q.text, q.id);
  }));
  await rm(RESTORE, { force: true });
  // A run that no restored loop or goal took back has no chat to go on in.
  const taken = [...live.values()].map(({ chat }) => chat.state.session.repeat?.runId).concat(unrestored.map((u) => u.repeat?.runId));
  runs.endExcept(taken, 'AgentView restarted');
  saveSoon();
  return (saved.view && bySession(saved.view)) || null;
}

async function prompt(cwd: string, text: string, from?: string, fresh = false) {
  const reuse = fresh ? undefined : [...live.values()].map((l) => l.chat).filter((c) => c.cwd === cwd && !c.state.session.running && !c.state.pending.length).sort((a, b) => lastActive(b) - lastActive(a))[0];
  const chat = reuse ?? (from ? await newChat(cwd, get(from)) : await createChat(cwd));
  void chat.prompt(text);
  return chat.id;
}

function runTries(chat: AgentSession, text: string, tries: Exclude<ReturnType<typeof parseTries>, null>, id: string = randomUUID()) {
  chat.pushEvent({ id, kind: 'user', text, at: Date.now() });
  if (tries === 'usage') return chat.system(TRIES_USAGE);
  chat.system(`Starting ${tries.n} worktrees for this prompt`);
  void startTries(chat.cwd, tries.n, tries.prompt, (cwd, p) => prompt(cwd, p, chat.id, true)).then(
    (ids) => chat.system(`Started ${ids.length} chats, one per tries/ branch; they are listed in Sessions`),
    (err) => chat.system(`Tries failed: ${errText(err)}`),
  );
}

// Chat-level commands from a client. The ones whose failure the client should hear about return their promise.
function command(chat: AgentSession, msg: ClientMessage): Promise<unknown> | void {
  switch (msg.type) {
    case 'prompt': {
      if (typeof msg.text !== 'string') return;
      const id = typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined;
      const tries = parseTries(msg.text);
      if (tries) return runTries(chat, msg.text, tries, id);
      // The composer sends steer to stop Claude; a prompt during a run (Fix, Compact) waits its turn.
      void chat.prompt(msg.text, id);
      return;
    }
    case 'queue':
      if (typeof msg.text === 'string') void chat.queueNext(msg.text, typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined);
      return;
    case 'send_now':
      if (typeof msg.id === 'string') void chat.sendNow(msg.id);
      return;
    case 'steer':
      if (typeof msg.text === 'string') void chat.steer(msg.text, typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined);
      return;
    case 'plan':
      if (!Array.isArray(msg.next)) return;
      chat.changePlan(msg.next.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 120)).slice(0, 12));
      return;
    case 'answer':
      chat.answerQuestion(msg.id, msg.answers);
      return;
    case 'permission':
      chat.answerPermission(msg.id, msg.allow, msg.always);
      return;
    case 'retry':
      return chat.retryLast();
    case 'allow_blocked':
      return chat.allowBlocked(String(msg.id));
    case 'set_model':
      chat.setModel(msg.model).catch((err) => chat.system(`Could not set the model: ${errText(err)}`));
      return;
    case 'set_effort':
      return chat.setEffort(String(msg.effort));
    case 'set_account':
      chat.setAccount(String(msg.account));
      return;
    case 'set_permission_mode':
      void chat.setPermissionMode(msg.mode);
      return;
    case 'run':
      return chat.runControl(String(msg.run), msg.op);
    case 'set_loop':
      chat.setLoop(Boolean(msg.on), typeof msg.max === 'number' ? msg.max : undefined);
      return;
    case 'interrupt':
      void chat.interrupt();
      return;
    case 'rewind':
      return chat.rewind(String(msg.id));
    case 'stop_task':
      return chat.stopTask(String(msg.toolUseId));
    case 'mcp_status':
      void chat.refreshMcp();
      return;
    case 'usage':
      void chat.refreshUsage();
      return;
    case 'mcp_reconnect':
      void chat.reconnectMcp(String(msg.name));
      return;
    case 'mcp_toggle':
      void chat.toggleMcp(String(msg.name), Boolean(msg.enabled));
      return;
  }
}

async function handle(req: HostRequest): Promise<unknown> {
  switch (req.op) {
    case 'hello':
      await ready;
      return { last: lastViewed.id, restarting: Boolean(restarting), chats: liveList(), runs: runs.list() } satisfies Hello;
    case 'state':
      return get(req.id).view(req.limit);
    case 'events_before':
      return get(req.id).before(req.before, req.limit);
    case 'cmd':
      await command(get(req.id), req.msg);
      return null;
    case 'open':
      return (await openSaved(req.sessionId)).id;
    case 'new': {
      const chat = await newChat(req.cwd, get(req.from), req.fork);
      applyInitialModel(chat, req.model);
      return chat.id;
    }
    case 'close':
      return closeByUser(get(req.id));
    case 'rename': {
      const chat = bySession(req.sessionId);
      if (chat) {
        chat.title = req.title;
        broadcastLive();
      }
      return;
    }
    case 'ask':
      return prompt(req.cwd, req.prompt, req.from, req.fresh);
    case 'mcp_add': {
      const chat = get(req.id);
      const def = await configDef(chat.cwd, req.name);
      if (!def) throw new Error(`${req.name} is not in your MCP config`);
      return chat.addMcp(req.name, def);
    }
    case 'mcp_login':
      return get(req.id).loginMcp(req.name);
    case 'desktop':
      desktopAt = req.at;
      return;
    case 'viewers': {
      counts = req.counts;
      const last = live.get(req.last)?.chat;
      if (last) { lastViewed = last; remember(last); }
      broadcastLive();
      return;
    }
    case 'restart':
      return restart(req.now, req.force);
  }
}

mkdirSync(path.dirname(SOCK), { recursive: true });
let markReady!: () => void;
const ready = new Promise<void>((ok) => (markReady = ok));
// The state of a chat is sent before any later broadcast for it, since replies and broadcasts share one ordered socket.
const host = net.createServer((sock) => {
  const send = lines(sock, (v) => {
    const { n, ...req } = v as HostRequest & { n: number };
    const fail = (err: unknown) => n && send({ n, ok: false, error: errText(err) });
    // Answered at once, not after an await, so no broadcast for the chat can slip in between.
    if (req.op === 'state') {
      try {
        send({ n, ok: true, r: get(req.id).view(req.limit) });
      } catch (err) {
        fail(err);
      }
      return;
    }
    handle(req).then((r) => n && send({ n, ok: true, r: r ?? null }), fail);
  });
  apis.add(send);
  sock.on('close', () => {
    apis.delete(send);
    // Without an API server nobody is watching; stale counts would hold back the phone notifications.
    if (!apis.size) counts = {};
  });
  sock.on('error', () => {});
});
// Two hosts can start at once; the one that loses the socket leaves before it opens any chat.
await new Promise<void>((ok) => {
  let retried = false;
  host
    .on('listening', () => {
      serving = true;
      ok();
    })
    .on('error', async (err: NodeJS.ErrnoException) => {
      if (retried || err.code !== 'EADDRINUSE' || (await served())) process.exit(0);
      retried = true;
      try {
        unlinkSync(SOCK);
      } catch {}
      host.listen(SOCK);
    })
    .listen(SOCK);
});
console.log(`agent host on ${SOCK} for ${PROJECT}`);

const last = await readJson<any>(LAST, null);
lastViewed = (await restore().catch((err) => {
  console.error(`could not restore chats: ${errText(err)}`);
  return null;
})) ?? (await (last?.sessionId ? openSaved(last.sessionId).catch(() => createChat(PROJECT)) : createChat(PROJECT)));
markReady();
