import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { deleteSession, getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession } from './session.js';
import { listFiles, readFileWithOriginal } from './files.js';
import { allowedFolder, listRepos, listWorktrees, removeWorktree } from './worktrees.js';
import { STALE_MS, type ClientMessage, type LiveChat, type ServerMessage } from '../../shared/protocol.js';

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');

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
    if (m.type === 'session' && chat === lastViewed) remember(chat);
    if (m.type !== 'event' || m.event.kind === 'user') broadcastLive();
  });
  if (!resume) chat.start();
  live.set(chat.id, { chat, watcher: watchFiles(cwd, (rel) => chat.fileChangedExternally(rel)) });
  return chat;
}

function closeChat(chat: AgentSession) {
  chat.close();
  live.get(chat.id)?.watcher.close();
  live.delete(chat.id);
  broadcastLive();
}

const idle = (chat: AgentSession) => !chat.state.session.running && chat.state.pending.length === 0 && viewers(chat) === 0 && chat !== lastViewed;

function view(client: Client, chat: AgentSession) {
  const prev = client.view;
  client.view = chat;
  lastViewed = chat;
  remember(chat);
  client.send({ type: 'init', state: chat.state });
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
    if (url.pathname === '/api/files') return json(await listFiles(chat.cwd));
    if (url.pathname === '/api/file') {
      const rel = url.searchParams.get('path') ?? '';
      return json(await readFileWithOriginal(chat.cwd, rel));
    }
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
    if (url.pathname === '/api/worktrees') return json(await listWorktrees(liveCwds));
    if (url.pathname === '/api/repos') return json(await listRepos());
    if (url.pathname === '/api/sessions') {
      const list = await listSessions({ limit: 300 });
      return json(list.map((x) => ({ sessionId: x.sessionId, title: x.summary, cwd: x.cwd ?? '', gitBranch: x.gitBranch ?? null, lastModified: x.lastModified })));
    }
    if (url.pathname === '/api/state') return json(chat.state);
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

wss.on('connection', (ws: WebSocket) => {
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
        chat.sendPrompt(msg.text);
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
      case 'interrupt':
        void chat.interrupt();
        break;
      case 'view': {
        const next = live.get(msg.id)?.chat;
        if (next) view(client, next);
        else fail(new Error('This chat was closed'));
        break;
      }
      case 'open_session':
        openSaved(msg.sessionId).then((c) => view(client, c), fail);
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
});
