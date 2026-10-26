import { execFile } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { attachTerminal, closeTerminal, closeTerminals, createTerminal, listTerminals } from './workspace/terminal.js';
import { connect as connectChrome, openChrome, openInChrome, ownProfile } from './chrome/chrome.js';
import { listSessions } from './agent/claude/sessions.js';
import { ntfyTopic, post } from './integrations/notify.js';
import { configDef, connectorStatus, inSettings, mcpCall, mcpConfig, mcpGroups, mcpProbe, setMcpGroup } from './agent/claude/mcp.js';
import type { McpServerDef } from './integrations/mcpClient.js';
import { listBin, removeSession, restoreSession } from './agent/claude/bin.js';
import { listDir, listFiles, readFileWithOriginal, readImage } from './workspace/files.js';
import { github } from './integrations/github.js';
import { assistantRoute } from './integrations/assistant.js';
import { attention, dismissAttention, onAttention, refreshAttention, startAttention } from './integrations/attention.js';
import { dismissFinding, getFindings } from './session/findings.js';
import { deployRoute } from './integrations/deploy.js';
import { gitRoute } from './workspace/git.js';
import { observe } from './integrations/observe.js';
import { otherMacs, thisMac } from './http/macs.js';
import { createFolder, createWorktree, listRepos, listWorktrees, removeWorktree } from './workspace/worktrees.js';
import type { AttentionItem, ClientMessage, LiveChat, ServerMessage } from '../../shared/protocol.js';
import { Ring, frame } from './http/stream.js';
import { gz, serveWeb } from './http/web.js';
import { readBody, savePaste } from './http/body.js';
import { allowedPeer, allowedRequest, appOrigin, requester } from './http/access.js';
import { Host } from './host/client.js';
import type { Hello } from './host/protocol.js';

const PORT = Number(process.env.PORT ?? 7777);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const APK = path.resolve(here, '../../dist/AgentView.apk');

if (ownProfile()) {
  process.env.BROWSER = path.resolve(here, '../browser.sh');
  process.env.AGENTVIEW_PORT = String(PORT);
}

process.on('uncaughtException', (err) => {
  console.error('uncaught:', err);
  // Bun throws a taken port from inside listen. Without its port this process is useless; the menu bar app starts it again.
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && !server.listening) process.exit(1);
});
process.on('unhandledRejection', (err) => console.error('unhandled:', err));
// A signal skips the exit event, which stops the MCP servers in their own process groups; exit so it runs.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => process.exit(0));

// The chats live in the agent host (host/main.ts); this process serves the web client and relays to it.
type Client = { send: (m: ServerMessage) => void; sendRaw: (data: string, id?: number) => void; view: string; waiting?: boolean; close?: () => void };
const BOOT = Date.now();
// serve.sh leaves this when the web build fails and the previous build is served.
const BUILD_FAILED = path.join(os.homedir(), '.agentview', 'web-build-failed');
const clients = new Set<Client>();
const STALL_MS = 60_000;
const streams = new Map<string, Client>();
const ring = new Ring();
let chats = new Map<string, LiveChat>();
let lastViewed = '';
let restarting = false;

// To every client, or to the viewers of one chat. Each broadcast gets an id so an event stream can resume.
function broadcast(m: ServerMessage, chat: string | null = null) {
  const data = JSON.stringify(m);
  const id = ring.push(m.type === 'init' ? null : data, chat);
  for (const c of clients) if (!chat || (c.view === chat && !c.waiting)) c.sendRaw(data, id);
}

const bySession = (sessionId: string | null) => [...chats.values()].find((c) => c.sessionId === sessionId)?.id;

let viewersTimer: NodeJS.Timeout | null = null;
function reportViewers() {
  viewersTimer ??= setTimeout(() => {
    viewersTimer = null;
    const counts: Record<string, number> = {};
    for (const c of clients) counts[c.view] = (counts[c.view] ?? 0) + 1;
    host.notify({ op: 'viewers', counts, last: lastViewed });
  }, 50);
}

// Broadcasts for the chat are held back until its state arrives; the host sends the state before any later broadcast.
function view(client: Client, id: string) {
  client.view = id;
  client.waiting = true;
  lastViewed = id;
  reportViewers();
  host.call({ op: 'state', id }, (err, state) => {
    if (client.view !== id) return;
    client.waiting = false;
    if (err) return client.send({ type: 'error', text: err });
    client.send({ type: 'init', state: state as Extract<ServerMessage, { type: 'init' }>['state'], boot: BOOT });
    host.notify({ op: 'cmd', id, msg: { type: 'mcp_status' } });
  });
}

async function closeByUser(id: string) {
  const next = await host.req<string>({ op: 'close', id });
  if (lastViewed === id) lastViewed = next;
  for (const c of clients) if (c.view === id) view(c, next);
}

const host = new Host(PORT, PROJECT, {
  push: (l) => {
    if ('closed' in l) return closeTerminals(l.closed);
    if (l.m.type === 'live') chats = new Map(l.m.chats.map((c) => [c.id, c]));
    if (l.m.type === 'restarting') restarting = true;
    broadcast(l.m, l.chat);
  },
  up: () => host.call({ op: 'hello' }, (err, r) => {
    if (err) return;
    const hello = r as Hello;
    const before = chats;
    chats = new Map(hello.chats.map((c) => [c.id, c]));
    restarting = hello.restarting;
    lastViewed = chats.has(lastViewed) ? lastViewed : hello.last;
    // After a host restart the chats come back under new ids; a client follows its chat by session id.
    for (const c of clients) view(c, chats.has(c.view) ? c.view : (bySession(before.get(c.view)?.sessionId ?? null) ?? lastViewed));
    broadcast({ type: 'live', chats: hello.chats });
    // A new host starts with no viewers, an old one with counts from before; tell it who watches now.
    reportViewers();
    // A host still running older code restarts once its turns end.
    if (!restarting) host.call({ op: 'restart', now: false, force: false });
  }),
  down: () => {
    if (!restarting) broadcast({ type: 'restarting' });
    restarting = true;
  },
});

// Restarts this server at once; the host and its chats keep running unless its code changed or `full` asks for it.
function restart(now: boolean, full: boolean) {
  host.call({ op: 'restart', now, force: full }, () => setTimeout(() => process.exit(0), 100));
}

onAttention((items) => broadcast({ type: 'attention', items }));
function attentionSources(extra: string[] = []) {
  const all = [...chats.values()];
  const idle = all.filter((c) => !c.running && !c.pending && c.edits);
  return {
    cwds: [...new Set([...all.map((c) => c.cwd), ...extra])],
    edited: idle.map((c) => ({ cwd: c.cwd, chatId: c.id, at: c.lastActive })).sort((a, b) => b.at - a.at),
  };
}
const fixChat = (item: AttentionItem) => host.req<string>({ op: 'ask', cwd: item.cwd, prompt: item.prompt, fresh: true });
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
    res.writeHead(code, { 'content-type': 'application/json', 'content-encoding': 'gzip', vary: 'accept-encoding, origin' });
    res.end(out);
  };
  if (!allowedRequest(req.headers, requester(req))) return json({ error: 'Forbidden' }, 403);
  const app = appOrigin(req.headers, requester(req));
  if (app) {
    res.setHeader('access-control-allow-origin', app);
    res.setHeader('vary', 'origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, last-event-id',
        'access-control-max-age': '600',
        ...(req.headers['access-control-request-private-network'] && { 'access-control-allow-private-network': 'true' }),
      });
      return res.end();
    }
  }
  try {
    if (url.pathname.startsWith('/api/assistant/')) {
      const r = await assistantRoute(req.method ?? 'GET', url, () => readBody(req, 5_000_000));
      return json(r.body, r.status);
    }
    const chat = chats.get(url.searchParams.get('chat') ?? '') ?? chats.get(lastViewed);
    if (!chat) return json({ error: 'The agent host is starting' }, 503);
    const liveCwds = [...chats.values()].map((c) => c.cwd);
    if (url.pathname === '/api/events') {
      const asked = (url.searchParams.has('session') && bySession(url.searchParams.get('session'))) || (chats.has(url.searchParams.get('chat') ?? '') ? url.searchParams.get('chat')! : undefined);
      return openEvents(req, res, url, asked ?? chat.id, Boolean(asked));
    }
    if (url.pathname === '/api/cmd' && req.method === 'POST') {
      const msg = JSON.parse(await readBody(req)) as ClientMessage;
      if (typeof msg?.type !== 'string') throw new Error('Bad command');
      const client = streams.get(url.searchParams.get('cid') ?? '');
      // Without a stream or a chat there is no telling which chat the command is for.
      if (!client && !chats.has(url.searchParams.get('chat') ?? '')) return json({ error: 'No stream for this command' }, 409);
      // The chat the tab showed when the command was made, so a retry after a chat switch still lands there.
      handleCommand(client ?? { send: () => {}, sendRaw: () => {}, view: chat.id }, msg, url.searchParams.get('chat') || undefined);
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
      if (!(await configDef(chat.cwd, name))) return json({ error: `${name} is not in your MCP config` }, 404);
      return json(await host.req({ op: 'mcp_add', id: chat.id, name }));
    }
    if (url.pathname === '/api/mcp/login' && req.method === 'POST') {
      const r = await host.req<{ authUrl?: string }>({ op: 'mcp_login', id: chat.id, name: url.searchParams.get('name') ?? '' });
      if (r.authUrl) openInChrome(r.authUrl);
      return json(r);
    }
    if (url.pathname === '/api/open' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const target = String(body.url ?? '');
      if (!/^https?:\/\//.test(target)) return json({ error: 'Only http(s) links open' }, 400);
      if (body.browser === 'firefox' && process.platform === 'darwin') execFile('open', ['-a', 'Firefox', target], (err) => err && console.error('open in firefox:', err.message));
      else openInChrome(target);
      return json({ ok: true });
    }
    if (url.pathname === '/api/mcp/connectors') return json(await connectorStatus(url.searchParams.has('refresh')));
    if (url.pathname === '/api/mcp/probe') return json(await mcpProbe(chat.cwd, url.searchParams.has('refresh')));
    if (url.pathname === '/api/mcp/groups' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const service = String(body.service ?? '').trim();
      if (!service) return json({ error: 'service is required' }, 400);
      return json(await setMcpGroup(service, String(body.group ?? '')));
    }
    if (url.pathname === '/api/mcp/groups') return json(await mcpGroups());
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
    if (url.pathname === '/api/state') return json(await host.req({ op: 'state', id: chat.id }));
    if (url.pathname === '/api/restart' && req.method === 'POST') {
      restart(url.searchParams.has('now'), url.searchParams.has('full'));
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
      return json({ id: await host.req<string>({ op: 'ask', cwd: item.cwd, prompt: item.prompt, from: chat.id }) });
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
      const running = [...chats.values()].filter((c) => c.running).length;
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

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8_000_000, perMessageDeflate: { threshold: 1024 }, verifyClient: ({ req }: { req: http.IncomingMessage }) => allowedRequest(req.headers, requester(req)) });

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
  const chat = (chats.has(params.get('chat') ?? '') ? params.get('chat')! : undefined) ?? (params.has('session') ? bySession(params.get('session')) : undefined) ?? lastViewed;
  const sendRaw = (data: string) => ws.readyState === WebSocket.OPEN && ws.send(data);
  const client: Client = { send: (m) => sendRaw(JSON.stringify(m)), sendRaw, view: chat };
  clients.add(client);
  view(client, chat);
  // A phone coming back after its chat was idle-closed should get that chat back, not whatever was viewed last.
  const wanted = params.get('session');
  if (wanted && chats.get(chat)?.sessionId !== wanted) host.req<string>({ op: 'open', sessionId: wanted }).then((c) => client.view === chat && view(client, c), () => {});
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
    reportViewers();
  });
});

// Server-Sent Events: the same ServerMessage stream as /ws, resumable from Last-Event-ID through the ring buffer.
// The browser's own reconnect sends Last-Event-ID; the last param in its URL is from the first connect and stale by then.
// found: the stream asked for a chat that exists, so a resume may replay deltas; otherwise it gets a full init.
function openEvents(req: http.IncomingMessage, res: http.ServerResponse, url: URL, chat: string, found = true) {
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
  const missed = found ? ring.since(Number(req.headers['last-event-id'] ?? url.searchParams.get('last')), chat) : null;
  if (missed) {
    client.view = chat;
    for (const e of missed) client.sendRaw(e.data, e.id);
    reportViewers();
  } else view(client, chat);
  const wanted = url.searchParams.get('session');
  if (wanted && chats.get(chat)?.sessionId !== wanted) host.req<string>({ op: 'open', sessionId: wanted }).then((c) => client.view === chat && view(client, c), () => {});
  client.send({ type: 'attention', items: attention() });
  if (restarting) client.send({ type: 'restarting' });
  // A named event, not a comment: the client hears it and can tell a dead link from a quiet one.
  const ping = setInterval(() => (stalled && Date.now() - stalled > STALL_MS ? res.destroy() : write('event: ping\ndata:\n\n')), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
    if (streams.get(cid) === client) streams.delete(cid);
    reportViewers();
  });
}

function handleCommand(client: Client, msg: ClientMessage, target?: string) {
  const fail = (err: unknown) => client.send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
  switch (msg.type) {
    case 'close':
      if (chats.has(msg.id)) closeByUser(msg.id).catch(fail);
      break;
    case 'view':
      if (chats.has(msg.id)) view(client, msg.id);
      else fail(new Error('This chat was closed'));
      break;
    case 'open_session':
      host.req<string>({ op: 'open', sessionId: msg.sessionId }).then((c) => view(client, c), fail);
      break;
    case 'new_session':
      host.req<string>({ op: 'new', cwd: msg.cwd ?? chats.get(client.view)?.cwd ?? PROJECT, from: client.view, ...(typeof msg.fork === 'string' && { fork: msg.fork }) }).then((c) => view(client, c), fail);
      break;
    case 'restart':
      restart(Boolean(msg.now), false);
      break;
    default: {
      const id = target ?? client.view;
      if (!chats.has(id)) return fail(new Error('This chat was closed'));
      host.req({ op: 'cmd', id, msg }).catch(fail);
    }
  }
}

server.listen(PORT, () => console.log(`agentview on http://localhost:${PORT} for ${PROJECT}`));
if (existsSync(BUILD_FAILED)) post('The AgentView web build failed', 'Serving the previous build', 'See ~/.agentview/logs/server.log');

// The web app used to be on :5173; send old bookmarks and phone shells here.
if (PORT === 7777 && !process.env.AGENTVIEW_DEV_WEB) {
  http
    .createServer((req, res) => res.writeHead(301, { location: `http://${new URL(`http://${req.headers.host ?? 'localhost'}`).hostname}:${PORT}${req.url ?? '/'}` }).end())
    .on('error', () => {})
    .listen(5173);
}
void ntfyTopic().then((t) => console.log(t === 'off' ? 'push off' : 'push on, the ntfy topic is in ~/.agentview/observe.json'));
void connectChrome();
