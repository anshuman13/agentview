import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { attachTerminal, closeTerminal, closeTerminals, createTerminal, listTerminals } from './workspace/terminal.js';
import { connect as connectChrome, openChrome, openInChrome, ownProfile } from './chrome/chrome.js';
import { getSessionInfo, listSessions } from './agent/claude/sessions.js';
import { claudeSession } from './agent/claude/driver.js';
import type { AgentSession } from './session/session.js';
import type { Cron } from './agent/types.js';
import { notifyAway, notifyStall, ntfyTopic, stallWatch } from './integrations/notify.js';
import { configDef, inSettings, mcpCall, mcpConfig, mcpProbe } from './agent/claude/mcp.js';
import type { McpServerDef } from './integrations/mcpClient.js';
import { listBin, removeSession, restoreSession } from './agent/claude/bin.js';
import { listDir, listFiles, readFileWithOriginal, readImage } from './workspace/files.js';
import { github } from './integrations/github.js';
import { attention, dismissAttention, onAttention, refreshAttention, startAttention } from './integrations/attention.js';
import { dismissFinding, getFindings } from './session/findings.js';
import { deployRoute } from './integrations/deploy.js';
import { gitRoute } from './workspace/git.js';
import { observe } from './integrations/observe.js';
import { otherMacs, thisMac } from './http/macs.js';
import { allowedFolder, createFolder, createWorktree, listRepos, listWorktrees, removeWorktree } from './workspace/worktrees.js';
import { MCP_BAD, type AttentionItem, type ClientMessage, type LiveChat, type Repeat, type ServerMessage } from '../../shared/protocol.js';
import { Ring, frame } from './http/stream.js';
import { gz, serveWeb } from './http/web.js';
import { readBody, savePaste } from './http/body.js';
import { chatCost } from '../../shared/cost.js';
import { replyLine, sumEdits } from '../../shared/edits.js';
import { allowedPeer, allowedRequest, requester } from './http/access.js';

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const APK = path.resolve(here, '../../dist/AgentView.apk');

if (ownProfile()) {
  process.env.BROWSER = path.resolve(here, '../browser.sh');
  process.env.AGENTVIEW_PORT = String(PORT);
}

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.venv|venv|__pycache__|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.tox)(\/|$)/;

const LAST = path.join(os.homedir(), '.agentview-last.json');
const RESTORE = path.join(os.homedir(), '.agentview', 'restore.json');

process.on('uncaughtException', (err) => console.error('uncaught:', err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err));

const IDLE_MS = 10 * 60 * 1000;

type Client = { send: (m: ServerMessage) => void; sendRaw: (data: string, id?: number) => void; view: AgentSession; close?: () => void };
const BOOT = Date.now();
const clients = new Set<Client>();
const STALL_MS = 60_000;
const streams = new Map<string, Client>();
const ring = new Ring();
const stalls = stallWatch((id) => {
  const l = live.get(id);
  if (!l) return;
  notifyStall(summary(l.chat));
  broadcastLive();
});

// To every client, or to the viewers of one chat. Each broadcast gets an id so an event stream can resume.
function broadcast(m: ServerMessage, chat?: AgentSession) {
  const data = JSON.stringify(m);
  const id = ring.push(m.type === 'init' ? null : data, chat ?? null);
  for (const c of clients) if (!chat || c.view === chat) c.sendRaw(data, id);
}
const live = new Map<string, { chat: AgentSession; watcher: FSWatcher }>();
let lastViewed: AgentSession;

const viewers = (chat: AgentSession) => [...clients].filter((c) => c.view === chat).length;
const bySession = (sessionId: string | null) => [...live.values()].find((l) => l.chat.state.session.sessionId === sessionId)?.chat;
const lastActive = (chat: AgentSession) => chat.state.events.at(-1)?.at ?? chat.created;

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
  const firstPrompt = s.events.find((e) => e.kind === 'user');
  return {
    id: chat.id,
    sessionId: s.session.sessionId,
    cwd: chat.cwd,
    title: chat.title || (firstPrompt?.kind === 'user' ? firstPrompt.text.split('\n')[0].slice(0, 80) : 'New chat'),
    running: s.session.running,
    pending: s.pending.length,
    status: s.status,
    lastActive: lastActive(chat),
    mcpFailed: s.session.mcp.filter((m) => MCP_BAD.includes(m.status)).length,
    cost: chatCost(s.events),
    stalled: stalls.stalled(chat.id),
    last: replyLine(s.events),
    edits: editsOf(chat),
    ...(s.session.pr && { pr: s.session.pr }),
  };
}

let liveTimer: NodeJS.Timeout | null = null;
function broadcastLive() {
  liveTimer ??= setTimeout(() => {
    liveTimer = null;
    for (const { chat } of live.values()) chat.watchHistory(viewers(chat) > 0);
    const chats = [...live.values()].map((l) => summary(l.chat)).sort((a, b) => b.lastActive - a.lastActive);
    broadcast({ type: 'live', chats });
  }, 100);
}

async function createChat(cwd: string, resume?: string, title = '', fork = false) {
  const chat = claudeSession(cwd, resume, fork);
  chat.title = title;
  await chat.loadHistory();
  chat.onMessage((m) => {
    broadcast(m, chat);
    notifyAway(m, () => (viewers(chat) ? null : summary(chat)));
    if (m.type === 'session' && chat === lastViewed) remember(chat);
    const woke = stalls.seen(chat.id, chat.state.session.running);
    if (woke || m.type !== 'event' || m.event.kind === 'user') broadcastLive();
  });
  if (!resume || fork) chat.start();
  live.set(chat.id, { chat, watcher: watchFiles(cwd, (rel) => chat.fileChangedExternally(rel)) });
  return chat;
}

function closeChat(chat: AgentSession) {
  chat.close();
  stalls.seen(chat.id, false);
  closeTerminals(chat.id);
  live.get(chat.id)?.watcher.close();
  live.delete(chat.id);
  broadcastLive();
}

async function closeByUser(chat: AgentSession) {
  const others = [...live.values()].map((l) => l.chat).filter((c) => c !== chat);
  const next = others.sort((a, b) => lastActive(b) - lastActive(a))[0] ?? (await createChat(chat.cwd));
  if (lastViewed === chat) lastViewed = next;
  for (const c of clients) if (c.view === chat) view(c, next);
  closeChat(chat);
}

const idle = (chat: AgentSession) => !chat.state.session.running && chat.crons.length === 0 && !chat.state.session.repeat && chat.state.pending.length === 0 && viewers(chat) === 0 && chat !== lastViewed;

function view(client: Client, chat: AgentSession) {
  client.view = chat;
  lastViewed = chat;
  remember(chat);
  client.send({ type: 'init', state: chat.state, boot: BOOT });
  void chat.refreshMcp();
  broadcastLive();
}

setInterval(() => {
  for (const { chat } of live.values()) if (idle(chat) && Date.now() - lastActive(chat) > IDLE_MS) closeChat(chat);
}, 60_000);

function watchFiles(cwd: string, onChange: (rel: string) => void) {
  const timers = new Map<string, NodeJS.Timeout>();
  return watch(cwd, { recursive: true }, (_, rel) => {
    if (!rel || IGNORED.test(rel)) return;
    clearTimeout(timers.get(rel));
    timers.set(rel, setTimeout(() => {
      timers.delete(rel);
      stat(path.join(cwd, rel)).then((s) => s.isFile() && onChange(rel)).catch(() => {});
    }, 200));
  }).on('error', (err) => console.error(`watcher: ${String(err)}`));
}

const isDir = (dir: string) => stat(dir).then((s) => s.isDirectory()).catch(() => false);

async function openSaved(sessionId: string) {
  const open = bySession(sessionId);
  if (open) return open;
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

let restarting: NodeJS.Timeout | null = null;

function saveAndExit() {
  const chats = [...live.values()].map(({ chat }) => ({ sessionId: chat.state.session.sessionId, crons: chat.crons, repeat: chat.state.session.repeat })).filter((c) => c.sessionId);
  mkdirSync(path.dirname(RESTORE), { recursive: true });
  writeFileSync(RESTORE, JSON.stringify({ view: lastViewed?.state.session.sessionId, chats }));
  process.exit(0);
}

function restart(now: boolean) {
  if (now) return saveAndExit();
  if (restarting) return;
  broadcast({ type: 'restarting' });
  for (const { chat } of live.values()) chat.holdRepeat();
  // A turn that never ends (a card nobody answers) must not hold the restart and every loop for good.
  const deadline = Date.now() + 10 * 60_000;
  restarting = setInterval(() => {
    if (Date.now() > deadline || ![...live.values()].some(({ chat }) => chat.state.session.running || chat.state.session.compacting)) saveAndExit();
  }, 1000);
}

process.on('SIGTERM', saveAndExit);

async function restore() {
  const saved: { view?: string; chats: { sessionId: string; crons: Cron[]; repeat?: Repeat | null }[] } | null = await readFile(RESTORE, 'utf8').then(JSON.parse).catch(() => null);
  if (!saved) return null;
  await rm(RESTORE, { force: true });
  await Promise.all(saved.chats.map(async (s) => {
    const chat = await openSaved(s.sessionId).catch(() => null);
    if (chat && s.crons.length) chat.restoreCrons(s.crons);
    if (chat && s.repeat) chat.resumeRepeat(s.repeat);
  }));
  return (saved.view && bySession(saved.view)) || null;
}

const last = await readFile(LAST, 'utf8').then(JSON.parse).catch(() => null);
lastViewed = (await restore()) ?? (await (last?.sessionId ? openSaved(last.sessionId).catch(() => createChat(PROJECT)) : createChat(PROJECT)));
onAttention((items) => broadcast({ type: 'attention', items }));
function attentionSources(extra: string[] = []) {
  const chats = [...live.values()].map((l) => l.chat);
  const idle = chats.filter((c) => !c.state.session.running && !c.state.pending.length && editsOf(c));
  return {
    cwds: [...new Set([...chats.map((c) => c.cwd), ...extra])],
    edited: idle.map((c) => ({ cwd: c.cwd, chatId: c.id, at: lastActive(c) })).sort((a, b) => b.at - a.at),
  };
}
async function fixChat(item: AttentionItem) {
  const chat = await createChat(item.cwd);
  void chat.prompt(item.prompt);
  return chat.id;
}
startAttention(attentionSources, fixChat);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = async (body: unknown, code = 200) => {
    const text = JSON.stringify(body);
    if (text.length < 1024 || !/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      res.writeHead(code, { 'content-type': 'application/json' });
      return res.end(text);
    }
    const out = await gz(text);
    res.writeHead(code, { 'content-type': 'application/json', 'content-encoding': 'gzip', vary: 'accept-encoding' });
    res.end(out);
  };
  if (!allowedRequest(req.headers)) return json({ error: 'Forbidden' }, 403);
  try {
    const chat = live.get(url.searchParams.get('chat') ?? '')?.chat ?? lastViewed;
    const liveCwds = [...live.values()].map((l) => l.chat.cwd);
    if (url.pathname === '/api/events') {
      const asked = (url.searchParams.has('session') && bySession(url.searchParams.get('session'))) || live.get(url.searchParams.get('chat') ?? '')?.chat;
      return openEvents(req, res, url, asked ?? chat, Boolean(asked));
    }
    if (url.pathname === '/api/cmd' && req.method === 'POST') {
      const msg = JSON.parse(await readBody(req)) as ClientMessage;
      if (typeof msg?.type !== 'string') throw new Error('Bad command');
      const client = streams.get(url.searchParams.get('cid') ?? '');
      // Without a stream or a chat there is no telling which chat the command is for.
      if (!client && !live.has(url.searchParams.get('chat') ?? '')) return json({ error: 'No stream for this command' }, 409);
      handleCommand(client ?? { send: () => {}, sendRaw: () => {}, view: chat }, msg);
      return json({ ok: true });
    }
    if (url.pathname === '/api/terms' && req.method === 'POST') return json(createTerminal(chat.id, chat.cwd));
    if (url.pathname === '/api/terms' && req.method === 'DELETE') return json(closeTerminal(url.searchParams.get('id') ?? ''));
    if (url.pathname === '/api/terms') return json(listTerminals(chat.id));
    if (url.pathname === '/api/files') return json(await listFiles(chat.cwd));
    if (url.pathname === '/api/dir') return json(await listDir(chat.cwd, url.searchParams.get('path') ?? ''));
    if (url.pathname === '/api/file') return json(await readFileWithOriginal(chat.cwd, url.searchParams.get('path') ?? ''));
    if (url.pathname === '/api/image') {
      const img = await readImage(chat.cwd, url.searchParams.get('path') ?? '');
      res.writeHead(200, { 'content-type': img.type, 'cache-control': 'no-cache', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' });
      return res.end(img.body);
    }
    if (url.pathname.startsWith('/api/git/')) return json(await gitRoute(chat.cwd, url.pathname.slice(9), url.searchParams, req.method === 'POST' ? JSON.parse(await readBody(req)) : null));
    if (url.pathname === '/api/sessions' && req.method === 'DELETE') {
      const id = url.searchParams.get('id') ?? '';
      const open = bySession(id);
      if (open) await closeByUser(open);
      return json(await removeSession(id, url.searchParams.has('purge')));
    }
    if (url.pathname === '/api/sessions/bin') return json(await listBin());
    if (url.pathname === '/api/sessions/restore' && req.method === 'POST') {
      await restoreSession(url.searchParams.get('id') ?? '');
      return json({ ok: true });
    }
    if (url.pathname === '/api/worktrees' && req.method === 'DELETE') {
      await removeWorktree(url.searchParams.get('id') ?? '', liveCwds);
      return json({ ok: true });
    }
    if (url.pathname === '/api/worktrees' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json({ cwd: await createWorktree(String(body.repo ?? ''), String(body.branch ?? '').trim()) });
    }
    if (url.pathname === '/api/worktrees') return json(await listWorktrees(liveCwds));
    if (url.pathname === '/api/repos') return json(await listRepos());
    if (url.pathname === '/api/paste' && req.method === 'POST') return json({ path: await savePaste(req, url.searchParams.get('name') ?? '') });
    if (url.pathname === '/api/folders' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json({ cwd: await createFolder(String(body.root ?? ''), String(body.name ?? '').trim()) });
    }
    if (url.pathname.startsWith('/api/observe')) return json(await observe(req, url, chat.cwd));
    if (url.pathname === '/api/mcp/config') return json(await mcpConfig(chat.cwd));
    if (url.pathname === '/api/mcp/add' && req.method === 'POST') {
      const name = url.searchParams.get('name') ?? '';
      const def = await configDef(chat.cwd, name);
      if (!def) return json({ error: `${name} is not in your MCP config` }, 404);
      return json(await chat.addMcp(name, def));
    }
    if (url.pathname === '/api/mcp/login' && req.method === 'POST') {
      const r = await chat.loginMcp(url.searchParams.get('name') ?? '');
      if (r.authUrl) openInChrome(r.authUrl);
      return json(r);
    }
    if (url.pathname === '/api/open' && req.method === 'POST') {
      const target = String(JSON.parse(await readBody(req)).url ?? '');
      if (!/^https?:\/\//.test(target)) return json({ error: 'Only http(s) links open' }, 400);
      openInChrome(target);
      return json({ ok: true });
    }
    if (url.pathname === '/api/mcp/probe') return json(await mcpProbe(chat.cwd, url.searchParams.has('refresh')));
    if (url.pathname === '/api/mcp/call' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const name = String(body.server ?? '');
      const def = await configDef(chat.cwd, name);
      if (!def) return json({ error: `${name} is not in your MCP config` }, 404);
      if (!(await inSettings(chat.cwd, name))) return json({ error: `${name} is not approved in Claude Code, so AgentView does not start it` }, 403);
      const r = await mcpCall(chat.cwd, name, def as McpServerDef, String(body.tool ?? ''), body.args ?? {});
      return json(r, 'error' in r ? 400 : 200);
    }
    if (url.pathname === '/api/sessions') {
      const [list, bin] = await Promise.all([listSessions({ limit: 300 }), listBin()]);
      const binned = new Set(bin.map((b) => b.sessionId));
      return json(list.filter((x) => !binned.has(x.sessionId)).map((x) => ({ sessionId: x.sessionId, title: x.summary, cwd: x.cwd ?? '', gitBranch: x.gitBranch ?? null, lastModified: x.lastModified })));
    }
    if (url.pathname === '/api/state') return json(chat.state);
    if (url.pathname === '/api/restart' && req.method === 'POST') {
      restart(url.searchParams.has('now'));
      return json({ ok: true });
    }
    if (url.pathname.startsWith('/api/gh/')) return json(await github(chat.cwd, req.method ?? 'GET', url, () => readBody(req)));
    if (url.pathname === '/api/attention') return json(url.searchParams.has('fresh') ? await refreshAttention(attentionSources([chat.cwd])) : attention());
    if (url.pathname === '/api/findings') return json(await getFindings(chat.cwd, url.searchParams.get('target') ?? 'local'));
    if (url.pathname === '/api/findings/dismiss' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json(await dismissFinding(chat.cwd, String(body.target ?? 'local'), String(body.key ?? '')));
    }
    if (url.pathname === '/api/attention/dismiss' && req.method === 'POST') return json(dismissAttention(String(JSON.parse(await readBody(req)).id ?? '')));
    if (url.pathname === '/api/attention/ask' && req.method === 'POST') {
      const wanted = JSON.parse(await readBody(req)).id;
      const item = attention().find((it) => it.id === wanted);
      if (!item) throw new Error('That item is gone');
      const target = [...live.values()].map((l) => l.chat).filter((c) => c.cwd === item.cwd && !c.state.session.running && !c.state.pending.length).sort((a, b) => lastActive(b) - lastActive(a))[0] ?? (await newChat(item.cwd, chat));
      void target.prompt(item.prompt);
      return json({ id: target.id });
    }
    if (url.pathname.startsWith('/api/deploy/')) return json(await deployRoute(chat.cwd, req.method ?? 'GET', url, () => readBody(req)));
    if (url.pathname === '/api/app') return json({ build: Number(await readFile(`${APK}.txt`, 'utf8').catch(() => '0')) || 0 });
    if (url.pathname === '/api/app.apk') {
      const body = await readFile(APK);
      res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename="AgentView.apk"' });
      return res.end(body);
    }
    if (url.pathname === '/api/connect') {
      const port = [url.searchParams.get('port'), req.headers.host?.match(/:(\d+)$/)?.[1]].find((p) => p && /^\d{1,5}$/.test(p)) ?? String(PORT);
      const ips = Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal && allowedPeer(a.address))
        .map((a) => a!.address);
      const running = [...live.values()].filter(({ chat }) => chat.state.session.running).length;
      const { macs, problem } = url.searchParams.has('peer') ? { macs: [] } : await otherMacs(port, requester(req));
      return json({ hostname: thisMac, urls: ips.map((ip) => `http://${ip}:${port}`), running, macs, netbird: problem });
    }

    if (!(await serveWeb(req, res, url))) return json({ error: 'web client not built, run npm run dev or npm run build' }, 404);
  } catch (err) {
    void json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

server.on('connection', (socket) => {
  let ok = false;
  try {
    ok = allowedPeer(socket.remoteAddress);
  } catch {}
  if (!ok) socket.destroy();
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8_000_000, perMessageDeflate: { threshold: 1024 }, verifyClient: ({ req }: { req: http.IncomingMessage }) => allowedRequest(req.headers) });

// Phones that drop off the VPN leave half-open sockets; without this they count as viewers for hours.
const alive = new WeakSet<WebSocket>();
const missed = new WeakMap<WebSocket, number>();
setInterval(() => {
  for (const ws of wss.clients) {
    // The ping sits behind queued data, so a slow link still downloading a big init gets one more round.
    const n = alive.has(ws) ? 0 : (missed.get(ws) ?? 0) + 1;
    if (n > 1 || (n === 1 && ws.bufferedAmount === 0)) {
      ws.terminate();
      continue;
    }
    missed.set(ws, n);
    alive.delete(ws);
    ws.ping();
  }
}, 30_000).unref();

wss.on('connection', (ws: WebSocket, req) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  const params = new URL(req.url ?? '', 'http://x').searchParams;
  const term = params.get('term');
  if (term !== null) return attachTerminal(ws, term);
  if (params.has('chrome')) return openChrome(ws, req.headers.origin);
  const chat = live.get(params.get('chat') ?? '')?.chat ?? (params.has('session') ? bySession(params.get('session')) : undefined) ?? lastViewed;
  const sendRaw = (data: string) => ws.readyState === WebSocket.OPEN && ws.send(data);
  const client: Client = { send: (m) => sendRaw(JSON.stringify(m)), sendRaw, view: chat };
  clients.add(client);
  view(client, chat);
  // A phone coming back after its chat was idle-closed should get that chat back, not whatever was viewed last.
  const wanted = params.get('session');
  if (wanted && chat.state.session.sessionId !== wanted) openSaved(wanted).then((c) => client.view === chat && view(client, c), () => {});
  client.send({ type: 'attention', items: attention() });
  if (restarting) client.send({ type: 'restarting' });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    handleCommand(client, msg);
  });
  ws.on('close', () => {
    clients.delete(client);
    broadcastLive();
  });
});

// Server-Sent Events: the same ServerMessage stream as /ws, resumable from Last-Event-ID through the ring buffer.
// found: the stream asked for a chat that exists, so a resume may replay deltas; otherwise it gets a full init.
function openEvents(req: http.IncomingMessage, res: http.ServerResponse, url: URL, chat: AgentSession, found = true) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders();
  const cid = url.searchParams.get('cid') || randomUUID();
  // A tab that reopens its stream replaces the old one, which may be a half-open socket that would count as a viewer for hours.
  streams.get(cid)?.close?.();
  req.socket.setKeepAlive(true, 15_000);
  // A write that does not drain for a minute means a half-open socket (a phone that left the VPN); it is no viewer.
  let stalled = 0;
  const write = (data: string) => { if (!res.write(data)) stalled ||= Date.now(); };
  res.on('drain', () => (stalled = 0));
  const client: Client = { send: (m) => client.sendRaw(JSON.stringify(m), ring.seq), sendRaw: (data, id) => write(frame(data, id)), view: chat, close: () => res.destroy() };
  clients.add(client);
  streams.set(cid, client);
  const missed = found ? ring.since(Number(url.searchParams.get('last') ?? req.headers['last-event-id']), chat) : null;
  if (missed) {
    client.view = chat;
    for (const e of missed) client.sendRaw(e.data, e.id);
    broadcastLive();
  } else view(client, chat);
  const wanted = url.searchParams.get('session');
  if (wanted && chat.state.session.sessionId !== wanted) openSaved(wanted).then((c) => client.view === chat && view(client, c), () => {});
  client.send({ type: 'attention', items: attention() });
  if (restarting) client.send({ type: 'restarting' });
  // A named event, not a comment: the client hears it and can tell a dead link from a quiet one.
  const ping = setInterval(() => (stalled && Date.now() - stalled > STALL_MS ? res.destroy() : write('event: ping\ndata:\n\n')), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
    if (streams.get(cid) === client) streams.delete(cid);
    broadcastLive();
  });
}

function handleCommand(client: Client, msg: ClientMessage) {
  const chat = client.view;
  const fail = (err: unknown) => client.send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
  switch (msg.type) {
    case 'prompt': {
      if (typeof msg.text !== 'string') break;
      const id = typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined;
      // A client with stale state may send a plain prompt while Claude runs; the user's message still goes first.
      void (chat.state.session.running ? chat.steer(msg.text, id) : chat.prompt(msg.text, id));
      break;
    }
    case 'steer':
      if (typeof msg.text === 'string') void chat.steer(msg.text, typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined);
      break;
    case 'plan':
      if (!Array.isArray(msg.next)) break;
      chat.changePlan(msg.next.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 120)).slice(0, 12));
      break;
    case 'answer':
      chat.answerQuestion(msg.id, msg.answers);
      break;
    case 'permission':
      chat.answerPermission(msg.id, msg.allow, msg.always);
      break;
    case 'allow_blocked':
      void chat.allowBlocked(String(msg.id)).catch(fail);
      break;
    case 'set_model':
      void chat.setModel(msg.model);
      break;
    case 'set_effort':
      void chat.setEffort(String(msg.effort)).catch(fail);
      break;
    case 'set_permission_mode':
      void chat.setPermissionMode(msg.mode);
      break;
    case 'set_loop':
      chat.setLoop(Boolean(msg.on), typeof msg.max === 'number' ? msg.max : undefined);
      break;
    case 'interrupt':
      void chat.interrupt();
      break;
    case 'rewind':
      void chat.rewind(String(msg.id)).catch(fail);
      break;
    case 'stop_task':
      void chat.stopTask(String(msg.toolUseId)).catch(fail);
      break;
    case 'close': {
      const target = live.get(msg.id)?.chat;
      if (target) closeByUser(target).catch(fail);
      break;
    }
    case 'view': {
      const next = live.get(msg.id)?.chat;
      if (next) view(client, next);
      else fail(new Error('This chat was closed'));
      break;
    }
    case 'open_session':
      openSaved(msg.sessionId).then((c) => view(client, c), fail);
      break;
    case 'mcp_status':
      void chat.refreshMcp();
      break;
    case 'mcp_reconnect':
      void chat.reconnectMcp(String(msg.name));
      break;
    case 'mcp_toggle':
      void chat.toggleMcp(String(msg.name), Boolean(msg.enabled));
      break;
    case 'restart':
      restart(Boolean(msg.now));
      break;
    case 'new_session':
    newChat(msg.cwd ?? chat.cwd, chat, typeof msg.fork === 'string' ? msg.fork : undefined).then((c) => view(client, c), fail);
    break;
  }
}

server.listen(PORT, () => {
  console.log(`agentview on http://localhost:${PORT} for ${PROJECT}`);
  void ntfyTopic().then((t) => console.log(t === 'off' ? 'push off' : `push: subscribe to ntfy topic ${t}`));
  void connectChrome();
});
