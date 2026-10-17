import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { attachTerminal, closeTerminal, closeTerminals, createTerminal, listTerminals } from './terminal.js';
import { connect as connectChrome, openChrome } from './chrome.js';
import { deleteSession, getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession } from './session.js';
import { notifyAway } from './notify.js';
import { mcpConfig, mcpProbe } from './mcp.js';
import { listDir, listFiles, readFileWithOriginal } from './files.js';
import { github } from './github.js';
import { deployRoute } from './deploy.js';
import { gitRoute } from './git.js';
import { observe } from './observe.js';
import { allowedFolder, createWorktree, listRepos, listWorktrees, removeWorktree } from './worktrees.js';
import { MCP_BAD, STALE_MS, type ClientMessage, type LiveChat, type ServerMessage } from '../../shared/protocol.js';
import { replyLine, sumEdits } from '../../shared/edits.js';

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');
const DEV_WEB = process.env.AGENTVIEW_DEV_WEB;

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.venv|venv|__pycache__|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.tox)(\/|$)/;

const LAST = path.join(os.homedir(), '.agentview-last.json');

process.on('uncaughtException', (err) => console.error('uncaught:', err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err));

const IDLE_MS = 10 * 60 * 1000;

type Client = { send: (m: ServerMessage) => void; view: AgentSession };
const clients = new Set<Client>();
const live = new Map<string, { chat: AgentSession; watcher: FSWatcher }>();
let lastViewed: AgentSession;

const viewers = (chat: AgentSession) => [...clients].filter((c) => c.view === chat).length;

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
    lastActive: s.events[s.events.length - 1]?.at ?? chat.created,
    mcpFailed: s.session.mcp.filter((m) => MCP_BAD.includes(m.status)).length,
    last: replyLine(s.events),
    edits: sumEdits(s.events),
  };
}

let liveTimer: NodeJS.Timeout | null = null;
function broadcastLive() {
  liveTimer ??= setTimeout(() => {
    liveTimer = null;
    const chats = [...live.values()].map((l) => summary(l.chat)).sort((a, b) => b.lastActive - a.lastActive);
    clients.forEach((c) => c.send({ type: 'live', chats }));
  }, 100);
}

async function createChat(cwd: string, resume?: string, title = '') {
  const chat = new AgentSession(cwd, resume);
  chat.title = title;
  await chat.loadHistory();
  chat.onMessage((m) => {
    clients.forEach((c) => c.view === chat && c.send(m));
    notifyAway(m, () => (viewers(chat) ? null : summary(chat)));
    if (m.type === 'session' && chat === lastViewed) remember(chat);
    if (m.type !== 'event' || m.event.kind === 'user') broadcastLive();
  });
  if (!resume) chat.start();
  live.set(chat.id, { chat, watcher: watchFiles(cwd, (rel) => chat.fileChangedExternally(rel)) });
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
  const others = [...live.values()].map((l) => l.chat).filter((c) => c !== chat);
  const next = others.sort((a, b) => summary(b).lastActive - summary(a).lastActive)[0] ?? (await createChat(chat.cwd));
  if (lastViewed === chat) lastViewed = next;
  for (const c of clients) if (c.view === chat) view(c, next);
  closeChat(chat);
}

const idle = (chat: AgentSession) => !chat.state.session.running && chat.state.pending.length === 0 && viewers(chat) === 0 && chat !== lastViewed;

function view(client: Client, chat: AgentSession) {
  const prev = client.view;
  client.view = chat;
  lastViewed = chat;
  remember(chat);
  client.send({ type: 'init', state: chat.state });
  void chat.refreshMcp();
  if (prev && prev !== chat && idle(prev) && !prev.state.session.sessionId) closeChat(prev);
  broadcastLive();
}

setInterval(() => {
  for (const { chat } of live.values()) if (idle(chat) && Date.now() - summary(chat).lastActive > IDLE_MS) closeChat(chat);
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

const isDir = (dir: string) => stat(dir).then((s) => s.isDirectory()).catch(() => false);

async function openSaved(sessionId: string) {
  const open = [...live.values()].find((l) => l.chat.state.session.sessionId === sessionId);
  if (open) return open.chat;
  const info = await getSessionInfo(sessionId);
  if (!info) throw new Error('Session not found');
  if (!info.cwd) throw new Error('This session has no folder recorded, so it cannot be resumed');
  if (!(await isDir(info.cwd))) throw new Error(`Folder no longer exists: ${info.cwd}`);
  return createChat(info.cwd, sessionId, info.summary);
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
  writeFile(LAST, JSON.stringify({ sessionId, cwd: chat.cwd })).catch(() => {});
}

const last = await readFile(LAST, 'utf8').then(JSON.parse).catch(() => null);
lastViewed = await (last?.sessionId ? openSaved(last.sessionId).catch(() => createChat(PROJECT)) : createChat(PROJECT));

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (body: unknown, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const chat = live.get(url.searchParams.get('chat') ?? '')?.chat ?? lastViewed;
    const liveCwds = [...live.values()].map((l) => l.chat.cwd);
    if (url.pathname === '/api/terms' && req.method === 'POST') return json(createTerminal(chat.id, chat.cwd));
    if (url.pathname === '/api/terms' && req.method === 'DELETE') return json(closeTerminal(url.searchParams.get('id') ?? ''));
    if (url.pathname === '/api/terms') return json(listTerminals(chat.id));
    if (url.pathname === '/api/files') return json(await listFiles(chat.cwd));
    if (url.pathname === '/api/dir') return json(await listDir(chat.cwd, url.searchParams.get('path') ?? ''));
    if (url.pathname === '/api/file') {
      const rel = url.searchParams.get('path') ?? '';
      return json(await readFileWithOriginal(chat.cwd, rel));
    }
    if (url.pathname.startsWith('/api/git/')) return json(await gitRoute(chat.cwd, url.pathname.slice(9), url.searchParams, req.method === 'POST' ? JSON.parse(await readBody(req)) : null));
    if (url.pathname === '/api/sessions' && req.method === 'DELETE') {
      const id = url.searchParams.get('id') ?? '';
      if ([...live.values()].some((l) => l.chat.state.session.sessionId === id)) return json({ error: 'This chat is still open. It closes after 10 minutes without use.' }, 409);
      const info = await getSessionInfo(id);
      if (!info) return json({ error: 'Chat not found' }, 404);
      if (Date.now() - info.lastModified < STALE_MS) return json({ error: 'This chat was used in the last 12 hours.' }, 409);
      await deleteSession(id, { dir: info.cwd });
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
    if (url.pathname.startsWith('/api/observe')) return json(await observe(req, url, chat.cwd));
    if (url.pathname === '/api/mcp/config') return json(await mcpConfig(chat.cwd));
    if (url.pathname === '/api/mcp/probe') return json(await mcpProbe(chat.cwd, url.searchParams.has('refresh')));
    if (url.pathname === '/api/sessions') {
      const list = await listSessions({ limit: 300 });
      return json(list.map((x) => ({ sessionId: x.sessionId, title: x.summary, cwd: x.cwd ?? '', gitBranch: x.gitBranch ?? null, lastModified: x.lastModified })));
    }
    if (url.pathname === '/api/state') return json(chat.state);
    if (url.pathname.startsWith('/api/gh/')) return json(await github(chat.cwd, req.method ?? 'GET', url, () => readBody(req)));
    if (url.pathname.startsWith('/api/deploy/')) return json(await deployRoute(chat.cwd, req.method ?? 'GET', url, () => readBody(req)));
    if (url.pathname === '/api/connect') {
      const port = url.searchParams.get('port') || (req.headers.host?.match(/:(\d+)$/)?.[1] ?? String(PORT));
      const ips = Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal)
        .map((a) => a!.address);
      const rank = (ip: string) => (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ? 0 : ip.startsWith('192.168.') || ip.startsWith('10.') ? 1 : 2);
      ips.sort((a, b) => rank(a) - rank(b));
      return json({ hostname: os.hostname(), urls: ips.map((ip) => `http://${ip}:${port}`) });
    }

    if (DEV_WEB) {
      res.writeHead(302, { location: `http://${(req.headers.host ?? 'localhost').replace(/:\d+$/, '')}:${DEV_WEB}${url.pathname}${url.search}` });
      return res.end();
    }
    let file = path.join(WEB_DIST, url.pathname === '/' ? 'index.html' : url.pathname);
    const exists = await stat(file).then((s) => s.isFile()).catch(() => false);
    if (!exists) file = path.join(WEB_DIST, 'index.html');
    const body = await readFile(file).catch(() => null);
    if (!body) return json({ error: 'web client not built, run npm run dev or npm run build' }, 404);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
  const params = new URL(req.url ?? '', 'http://x').searchParams;
  const term = params.get('term');
  if (term !== null) return attachTerminal(ws, term);
  if (params.has('chrome')) return openChrome(ws, req.headers.origin);
  const client: Client = { send: (m) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)), view: lastViewed };
  clients.add(client);
  view(client, lastViewed);
  const fail = (err: unknown) => client.send({ type: 'error', text: err instanceof Error ? err.message : String(err) });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const chat = client.view;
    switch (msg.type) {
      case 'prompt':
        void chat.prompt(msg.text);
        break;
      case 'steer':
        void chat.steer(msg.text, typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined);
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
      case 'new_session':
        newChat(msg.cwd ?? chat.cwd, chat).then((c) => view(client, c), fail);
        break;
    }
  });
  ws.on('close', () => {
    clients.delete(client);
    broadcastLive();
  });
});

server.listen(PORT, () => {
  console.log(`agentview on http://localhost:${PORT} for ${PROJECT}`);
  void connectChrome();
});
