import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import { AgentSession } from './session.js';
import { listFiles, readFileWithOriginal } from './files.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');

const session = new AgentSession(PROJECT);
session.start();

chokidar
  .watch(PROJECT, {
    ignored: (p) => /(^|\/)(node_modules|\.git|dist)(\/|$)/.test(p),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  })
  .on('change', (p) => session.fileChangedExternally(path.relative(PROJECT, p)))
  .on('add', (p) => session.fileChangedExternally(path.relative(PROJECT, p)));

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
    if (url.pathname === '/api/files') return json(await listFiles(PROJECT));
    if (url.pathname === '/api/file') {
      const rel = url.searchParams.get('path') ?? '';
      return json(await readFileWithOriginal(PROJECT, rel));
    }
    if (url.pathname === '/api/state') return json(session.state);

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
  const off = session.onMessage(send);

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
    }
  });
  ws.on('close', off);
});

server.listen(PORT, () => {
  console.log(`agentview on http://localhost:${PORT} for ${PROJECT}`);
});
