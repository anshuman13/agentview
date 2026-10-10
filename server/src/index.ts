import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar, { type FSWatcher } from 'chokidar';
import { getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession } from './session.js';
import { listFiles, readFileWithOriginal } from './files.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.venv|venv|__pycache__|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.tox)(\/|$)/;

const clients = new Set<(m: ServerMessage) => void>();
let session: AgentSession;
let watcher: FSWatcher | null = null;

async function openSession(cwd: string, resume?: string) {
  const next = new AgentSession(cwd, resume);
  await next.loadHistory();
  session?.close();
  void watcher?.close();
  session = next;
  session.onMessage((m) => clients.forEach((c) => c(m)));
  if (!resume) session.start();
  watcher = chokidar
    .watch(cwd, {
      ignored: (p) => IGNORED.test(p),
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200 },
    })
    .on('change', (p) => session.fileChangedExternally(path.relative(cwd, p)))
    .on('add', (p) => session.fileChangedExternally(path.relative(cwd, p)))
    .on('error', (err) => console.error(`watcher: ${String(err)}`));
  clients.forEach((c) => c({ type: 'init', state: session.state }));
}

async function openSavedSession(sessionId: string) {
  const info = await getSessionInfo(sessionId);
  if (!info) throw new Error('Session not found');
  if (!info.cwd) throw new Error('This session has no folder recorded, so it cannot be resumed');
  const exists = await stat(info.cwd).then((s) => s.isDirectory()).catch(() => false);
  if (!exists) throw new Error(`Folder no longer exists: ${info.cwd}`);
  await openSession(info.cwd, sessionId);
}

await openSession(PROJECT);

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
    if (url.pathname === '/api/files') return json(await listFiles(session.cwd));
    if (url.pathname === '/api/file') {
      const rel = url.searchParams.get('path') ?? '';
      return json(await readFileWithOriginal(session.cwd, rel));
    }
    if (url.pathname === '/api/sessions') {
      const list = await listSessions({ limit: 300 });
      return json(list.map((x) => ({ sessionId: x.sessionId, title: x.summary, cwd: x.cwd ?? '', gitBranch: x.gitBranch ?? null, lastModified: x.lastModified })));
    }
    if (url.pathname === '/api/state') return json(session.state);
    if (url.pathname === '/api/connect') {
      const port = url.searchParams.get('port') || (req.headers.host?.match(/:(\d+)$/)?.[1] ?? String(PORT));
      const ips = Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal)
        .map((a) => a!.address);
      const lan = (ip: string) => (ip.startsWith('192.168.') || ip.startsWith('10.') ? 0 : 1);
      ips.sort((a, b) => lan(a) - lan(b));
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
    json({ error: String(err) }, 500);
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  const send = (m: ServerMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  send({ type: 'init', state: session.state });
  clients.add(send);
  const fail = (err: unknown) => send({ type: 'error', text: err instanceof Error ? err.message : String(err) });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'prompt':
        session.sendPrompt(msg.text);
        break;
      case 'answer':
        session.answerQuestion(msg.id, msg.answers);
        break;
      case 'permission':
        session.answerPermission(msg.id, msg.allow, msg.always);
        break;
      case 'set_model':
        void session.setModel(msg.model);
        break;
      case 'set_permission_mode':
        void session.setPermissionMode(msg.mode);
        break;
      case 'interrupt':
        void session.interrupt();
        break;
      case 'open_session':
        openSavedSession(msg.sessionId).catch(fail);
        break;
      case 'new_session':
        openSession(session.cwd).catch(fail);
        break;
    }
  });
  ws.on('close', () => clients.delete(send));
});

server.listen(PORT, () => {
  console.log(`agentview on http://localhost:${PORT} for ${PROJECT}`);
});
