import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants as zlib } from 'node:zlib';
import { WebSocketServer, WebSocket } from 'ws';
import { attachTerminal, closeTerminal, closeTerminals, createTerminal, listTerminals } from './terminal.js';
import { connect as connectChrome, openChrome, openInChrome, ownProfile } from './chrome.js';
import { getSessionInfo, listSessions, type SessionCronSummary } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession } from './session.js';
import { Inbox } from './inbox.js';
import { Replay } from './replay.js';
import { findChat, parseSince } from './route.js';
import { notifyAway } from './notify.js';
import { configDef, inSettings, mcpCall, mcpConfig, mcpProbe } from './mcp.js';
import type { McpServerDef } from './mcpClient.js';
import { listBin, removeSession, restoreSession } from './bin.js';
import { listDir, listFiles, readFileWithOriginal, readImage } from './files.js';
import { github } from './github.js';
import { deployRoute } from './deploy.js';
import { gitRoute } from './git.js';
import { observe } from './observe.js';
import { otherMacs, thisMac } from './macs.js';
import { allowedFolder, createFolder, createWorktree, listRepos, listWorktrees, removeWorktree } from './worktrees.js';
import { MCP_BAD, type ClientMessage, type LiveChat, type ServerMessage, type Target } from '../../shared/protocol.js';
import { replyLine, sumEdits } from '../../shared/edits.js';
import { allowedPeer, allowedRequest } from './access.js';

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');
const DEV_WEB = process.env.AGENTVIEW_DEV_WEB;
const APK = path.resolve(here, '../../dist/AgentView.apk');

if (ownProfile()) {
  process.env.BROWSER = path.resolve(here, '../browser.sh');
  process.env.AGENTVIEW_PORT = String(PORT);
}

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.venv|venv|__pycache__|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.tox)(\/|$)/;

const LAST = path.join(os.homedir(), '.agentview-last.json');
const RESTORE = path.join(os.homedir(), '.agentview', 'restore.json');

for (const k of ['log', 'warn', 'error'] as const) {
  const write = console[k].bind(console);
  console[k] = (...args: unknown[]) => write(new Date().toISOString(), ...args);
}

process.on('uncaughtException', (err) => console.error('uncaught:', err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err));

const IDLE_MS = 10 * 60 * 1000;

type Client = { send: (m: ServerMessage) => void; sendRaw: (data: string) => void; view: AgentSession | null };
const clients = new Set<Client>();

// Serializes the message once, and only if some client receives it.
function broadcast(m: ServerMessage, to: (c: Client) => boolean = () => true) {
  let data: string | undefined;
  for (const c of clients) if (to(c)) c.sendRaw((data ??= JSON.stringify(m)));
}
const live = new Map<string, { chat: AgentSession; watcher: FSWatcher; replay: Replay }>();
let lastViewed: AgentSession;
const inbox = new Inbox(path.join(os.homedir(), '.agentview', 'inbox.json'));
// Chats the user closed. A reconnecting client must not bring them back.
const closedByUser = new Set<string>();
const openChats = () => [...live.values()].map((l) => l.chat);

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
    last: replyLine(s.events),
    edits: editsOf(chat),
  };
}

let liveTimer: NodeJS.Timeout | null = null;
function broadcastLive() {
  liveTimer ??= setTimeout(() => {
    liveTimer = null;
    for (const { chat } of live.values()) chat.watchTranscript(viewers(chat) > 0);
    const chats = [...live.values()].map((l) => summary(l.chat)).sort((a, b) => b.lastActive - a.lastActive);
    broadcast({ type: 'live', chats });
  }, 100);
}

async function createChat(cwd: string, resume?: string, title = '', id?: string) {
  const chat = new AgentSession(cwd, resume, id);
  chat.title = title;
  await chat.loadHistory();
  const replay = new Replay();
  chat.onDelivered = (cid) => inbox.done(cid);
  chat.onMessage((m) => {
    const data = replay.stamp(m);
    for (const c of clients) if (c.view === chat) c.sendRaw(data);
    notifyAway(m, () => (viewers(chat) ? null : summary(chat)));
    if (m.type === 'session' && chat === lastViewed) remember(chat);
    if (m.type !== 'event' || m.event.kind === 'user') broadcastLive();
  });
  if (!resume) chat.start();
  live.set(chat.id, { chat, replay, watcher: watchFiles(cwd, (rel) => chat.fileChangedExternally(rel)) });
  return chat;
}

function closeChat(chat: AgentSession) {
  chat.close();
  closeTerminals(chat.id);
  live.get(chat.id)?.watcher.close();
  live.delete(chat.id);
  broadcastLive();
}

async function closeByUser(chat: AgentSession) {
  closedByUser.add(chat.id);
  if (chat.state.session.sessionId) closedByUser.add(chat.state.session.sessionId);
  inbox.dropChat(chat.id);
  const others = [...live.values()].map((l) => l.chat).filter((c) => c !== chat);
  const next = others.sort((a, b) => lastActive(b) - lastActive(a))[0] ?? (await createChat(chat.cwd));
  if (lastViewed === chat) lastViewed = next;
  for (const c of clients) if (c.view === chat) view(c, next);
  closeChat(chat);
}

const idle = (chat: AgentSession) => !chat.state.session.running && chat.waiting === 0 && chat.crons.length === 0 && chat.state.pending.length === 0 && viewers(chat) === 0 && chat !== lastViewed;

// Sends the chat to the client: only the missed messages when it resumes from a seq this chat still holds, else a full init.
function view(client: Client, chat: AgentSession, since?: { epoch: string; seq: number } | null) {
  client.view = chat;
  lastViewed = chat;
  remember(chat);
  const replay = live.get(chat.id)!.replay;
  const missed = since ? replay.since(since.epoch, since.seq) : null;
  if (missed) {
    for (const data of missed) client.sendRaw(data);
    client.send({ type: 'resumed', epoch: replay.epoch, seq: replay.seq });
  } else client.send({ type: 'init', state: chat.state, epoch: replay.epoch, seq: replay.seq });
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

async function readBody(req: http.IncomingMessage) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

const PASTES = path.join(os.homedir(), '.agentview', 'pastes');
async function savePaste(req: http.IncomingMessage, name: string) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 50_000_000) throw new Error('Files over 50 MB cannot be attached');
    chunks.push(chunk);
  }
  await mkdir(PASTES, { recursive: true });
  const safe = path.basename(name).replace(/[^\w.-]+/g, '-').slice(-80) || 'file';
  const file = path.join(PASTES, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${randomUUID().slice(0, 6)}-${safe}`);
  await writeFile(file, Buffer.concat(chunks));
  return file;
}

const isDir = (dir: string) => stat(dir).then((s) => s.isDirectory()).catch(() => false);

const opening = new Map<string, Promise<AgentSession>>();

// Opens a saved session once, even when several clients ask for it at the same time.
function openSaved(sessionId: string, id?: string) {
  const open = bySession(sessionId);
  if (open) return Promise.resolve(open);
  let p = opening.get(sessionId);
  if (!p) {
    p = (async () => {
      const info = await getSessionInfo(sessionId);
      if (!info) throw new Error('Session not found');
      if (!info.cwd) throw new Error('This session has no folder recorded, so it cannot be resumed');
      if (!(await isDir(info.cwd))) throw new Error(`Folder no longer exists: ${info.cwd}`);
      return createChat(info.cwd, sessionId, info.summary, id && !live.has(id) ? id : undefined);
    })().finally(() => opening.delete(sessionId));
    opening.set(sessionId, p);
  }
  return p;
}

// The chat a message or a reconnect names. A chat that is not open is reopened from its session, unless the user closed it.
async function target(to: { chat?: string | null; session?: string | null }) {
  const hit = findChat(openChats(), to);
  if (hit) return hit;
  if (!to.session || closedByUser.has(to.session) || (to.chat && closedByUser.has(to.chat))) return null;
  return openSaved(to.session, to.chat ?? undefined).catch(() => null);
}

const reliableTypes = new Set(['prompt', 'steer', 'plan', 'answer', 'permission', 'allow_blocked']);
// Cids being handled right now, so a resend on another socket during an await is a duplicate too.
const inFlight = new Set<string>();

// Runs a message the client retries until acked. The cid is saved, with the prompt text, before the message runs,
// so a resend after a lost ack or a restart is answered with "duplicate" and runs nothing.
async function reliable(client: Client, msg: ClientMessage & { cid?: string; to?: Target }, run: (chat: AgentSession, id?: string) => void) {
  const cid = typeof msg.cid === 'string' && msg.cid ? msg.cid.slice(0, 64) : null;
  if (cid && (inbox.has(cid) || inFlight.has(cid))) return client.send({ type: 'ack', cid, status: 'duplicate' });
  if (cid) inFlight.add(cid);
  try {
    await accepted(client, msg, cid, run);
  } finally {
    if (cid) inFlight.delete(cid);
  }
}

async function accepted(client: Client, msg: ClientMessage & { to?: Target }, cid: string | null, run: (chat: AgentSession, id?: string) => void) {
  const chat = msg.to && (msg.to.chat || msg.to.session) ? await target(msg.to) : client.view;
  if (!chat) {
    console.log(`rejected ${msg.type} ${cid ?? ''}: chat ${msg.to?.chat ?? '?'} is closed`);
    if (cid) client.send({ type: 'ack', cid, status: 'rejected', reason: 'This chat was closed' });
    return;
  }
  if (cid) {
    const text = msg.type === 'prompt' || msg.type === 'steer' ? msg.text : null;
    try {
      inbox.accept(cid, text === null ? undefined : { chat: chat.id, session: chat.state.session.sessionId, cwd: chat.cwd, kind: msg.type as 'prompt' | 'steer', text });
    } catch (err) {
      console.error(`inbox: ${String(err)}`);
      return client.send({ type: 'ack', cid, status: 'rejected', reason: `AgentView could not save the message: ${String(err)}` });
    }
  }
  run(chat, cid ?? undefined);
  if (cid) client.send({ type: 'ack', cid, status: 'accepted' });
}

// Prompts accepted before the last stop but never handed to Claude go out again, in order.
async function redeliver() {
  for (const item of inbox.pending()) {
    const chat = (await target(item)) ?? (item.session || closedByUser.has(item.chat) ? null : await createChat(item.cwd, undefined, '', item.chat).catch(() => null));
    if (!chat) {
      console.log(`dropped saved prompt ${item.cid}: its chat could not be reopened`);
      inbox.done(item.cid);
      continue;
    }
    console.log(`redelivering saved prompt ${item.cid} to chat ${chat.id}`);
    void chat.prompt(item.text, item.cid);
  }
}

async function newChat(cwd: string, from: AgentSession) {
  const dir = path.resolve(cwd);
  if (dir !== from.cwd && dir !== PROJECT && !allowedFolder(dir)) throw new Error(`Not a workspace folder: ${dir}`);
  if (!(await isDir(dir))) throw new Error(`Folder no longer exists: ${dir}`);
  return createChat(dir);
}

let remembered = '';
function remember(chat: AgentSession) {
  const sessionId = chat.state.session.sessionId;
  if (!sessionId || sessionId === remembered) return;
  remembered = sessionId;
  writeFile(LAST, JSON.stringify({ sessionId, cwd: chat.cwd, id: chat.id })).catch(() => {});
}

let restarting: NodeJS.Timeout | null = null;

function saveAndExit() {
  const chats = [...live.values()].map(({ chat }) => ({ id: chat.id, cwd: chat.cwd, sessionId: chat.state.session.sessionId, crons: chat.crons }));
  mkdirSync(path.dirname(RESTORE), { recursive: true });
  writeFileSync(RESTORE, JSON.stringify({ view: lastViewed?.id, chats }));
  process.exit(0);
}

function restart(now: boolean) {
  if (now) return saveAndExit();
  if (restarting) return;
  broadcast({ type: 'restarting' });
  restarting = setInterval(() => {
    if (![...live.values()].some(({ chat }) => chat.state.session.running || chat.state.session.compacting)) saveAndExit();
  }, 1000);
}

process.on('SIGTERM', saveAndExit);

async function restore() {
  const saved: { view?: string; chats: { id?: string; cwd?: string; sessionId: string | null; crons: SessionCronSummary[] }[] } | null = await readFile(RESTORE, 'utf8').then(JSON.parse).catch(() => null);
  if (!saved) return null;
  await rm(RESTORE, { force: true });
  for (const s of saved.chats) {
    const chat = s.sessionId ? await openSaved(s.sessionId, s.id).catch(() => null) : s.cwd && (await isDir(s.cwd)) ? await createChat(s.cwd, undefined, '', s.id) : null;
    if (chat && s.crons.length) chat.restoreCrons(s.crons);
  }
  return (saved.view && (live.get(saved.view)?.chat ?? bySession(saved.view))) || null;
}

const last = await readFile(LAST, 'utf8').then(JSON.parse).catch(() => null);
lastViewed = (await restore()) ?? (await (last?.sessionId ? openSaved(last.sessionId, last.id).catch(() => createChat(PROJECT)) : createChat(PROJECT)));
await redeliver();

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

// Compressed copies of web/dist files, made once per file version.
const packed = new Map<string, { mtime: number; br: Buffer; gzip: Buffer }>();
const brotli = promisify(brotliCompress);
const gz = promisify(gzip);
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.ttf']);

async function compressed(file: string, body: Buffer, mtime: number) {
  const hit = packed.get(file);
  if (hit?.mtime === mtime) return hit;
  const [br, gzipped] = await Promise.all([brotli(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }), gz(body, { level: 9 })]);
  const entry = { mtime, br, gzip: gzipped };
  packed.set(file, entry);
  return entry;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (body: unknown, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!allowedRequest(req.headers)) return json({ error: 'Forbidden' }, 403);
  try {
    const chat = live.get(url.searchParams.get('chat') ?? '')?.chat ?? lastViewed;
    const liveCwds = [...live.values()].map((l) => l.chat.cwd);
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
    if (url.pathname.startsWith('/api/deploy/')) return json(await deployRoute(chat.cwd, req.method ?? 'GET', url, () => readBody(req)));
    if (url.pathname === '/api/app') return json({ build: Number(await readFile(`${APK}.txt`, 'utf8').catch(() => '0')) || 0 });
    if (url.pathname === '/api/app.apk') {
      const body = await readFile(APK);
      res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename="AgentView.apk"' });
      return res.end(body);
    }
    if (url.pathname === '/api/connect') {
      const port = url.searchParams.get('port') || (req.headers.host?.match(/:(\d+)$/)?.[1] ?? String(PORT));
      const ips = Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal && allowedPeer(a.address))
        .map((a) => a!.address);
      const running = [...live.values()].filter(({ chat }) => chat.state.session.running).length;
      const { macs, problem } = url.searchParams.has('peer') ? { macs: [] } : await otherMacs(port);
      return json({ hostname: thisMac, urls: ips.map((ip) => `http://${ip}:${port}`), running, macs, netbird: problem });
    }

    if (DEV_WEB) {
      res.writeHead(302, { location: `http://${(req.headers.host ?? 'localhost').replace(/:\d+$/, '')}:${DEV_WEB}${url.pathname}${url.search}` });
      return res.end();
    }
    let file = path.join(WEB_DIST, url.pathname === '/' ? 'index.html' : url.pathname);
    let info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      file = path.join(WEB_DIST, 'index.html');
      info = await stat(file).catch(() => null);
    }
    const body = info && (await readFile(file).catch(() => null));
    if (!info || !body) return json({ error: 'web client not built, run npm run dev or npm run build' }, 404);
    const ext = path.extname(file);
    const headers: http.OutgoingHttpHeaders = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      // Vite puts a content hash in every file name under assets/, so those never change.
      'cache-control': file.startsWith(path.join(WEB_DIST, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(COMPRESS.has(ext) && { vary: 'accept-encoding' }),
    };
    const accept = String(req.headers['accept-encoding'] ?? '');
    const encoding = !COMPRESS.has(ext) || body.length < 1024 ? null : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    if (!encoding) {
      res.writeHead(200, headers);
      return res.end(body);
    }
    const out = (await compressed(file, body, info.mtimeMs))[encoding];
    res.writeHead(200, { ...headers, 'content-encoding': encoding });
    res.end(out);
  } catch (err) {
    json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

server.on('connection', (socket) => allowedPeer(socket.remoteAddress) || socket.destroy());

const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }: { req: http.IncomingMessage }) => allowedRequest(req.headers) });

// Server-side liveness: a socket that misses a pong is dead (a phone that went to the background, a dropped VPN),
// so it stops counting as a viewer. The tick gives the client traffic to judge its own socket by.
const alive = new WeakMap<WebSocket, boolean>();
setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
  broadcast({ type: 'tick' });
}, 20_000);

wss.on('connection', (ws: WebSocket, req) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  ws.on('error', (err) => console.error(`ws: ${String(err)}`));
  const params = new URL(req.url ?? '', 'http://x').searchParams;
  const term = params.get('term');
  if (term !== null) return attachTerminal(ws, term);
  if (params.has('chrome')) return openChrome(ws, req.headers.origin);
  const want = { chat: params.get('chat') || null, session: params.get('session') || null };
  const sendRaw = (data: string) => ws.readyState === WebSocket.OPEN && ws.send(data);
  const client: Client = { send: (m) => sendRaw(JSON.stringify(m)), sendRaw, view: null };
  clients.add(client);
  const fail = (err: unknown) => client.send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
  // Messages run one at a time, in order, after the client is attached to its chat.
  let chain = (async () => {
    const chat = (want.chat || want.session ? await target(want) : null) ?? lastViewed;
    if (!clients.has(client)) return;
    view(client, chat, chat.id === want.chat ? parseSince(params.get('since')) : null);
    if (want.chat && chat.id !== want.chat && (!want.session || chat.state.session.sessionId !== want.session)) fail(new Error('That chat was closed, so AgentView opened the latest one'));
    if (restarting) client.send({ type: 'restarting' });
  })().catch(fail);

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    chain = chain.then(() => handle(msg)).catch(fail);
  });

  async function handle(msg: ClientMessage) {
    if (!clients.has(client) || !client.view) return;
    const chat = client.view;
    if (reliableTypes.has(msg.type)) {
      return reliable(client, msg, (chat, id) => {
        switch (msg.type) {
          case 'prompt':
            void chat.prompt(String(msg.text), id);
            break;
          case 'steer':
            void chat.steer(String(msg.text), id ?? (typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined));
            break;
          case 'plan':
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
        }
      });
    }
    switch (msg.type) {
      case 'set_model':
        void chat.setModel(msg.model);
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
        closedByUser.delete(msg.sessionId);
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
      case 'ping':
        client.send({ type: 'pong' });
        break;
      case 'restart':
        restart(Boolean(msg.now));
        break;
      case 'new_session':
        newChat(msg.cwd ?? chat.cwd, chat).then((c) => view(client, c), fail);
        break;
    }
  }
  ws.on('close', () => {
    clients.delete(client);
    broadcastLive();
  });
});

server.listen(PORT, () => {
  console.log(`agentview on http://localhost:${PORT} for ${PROJECT}`);
  void connectChrome();
});
