import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { attachTerminal, closeTerminals } from './workspace/terminal.js';
import { connect as connectChrome, openChrome, ownProfile } from './chrome/chrome.js';
import { ntfyTopic, post } from './integrations/notify.js';
import { CODEX_WORK } from './workspace/files.js';
import { attention, onAttention, startAttention } from './integrations/attention.js';
import { thisMac } from './http/macs.js';
import { ROW_WINDOW, type AttentionItem, type ClientMessage, type LiveChat, type ServerMessage } from '../../shared/protocol.js';
import { Ring, frame } from './http/stream.js';
import { RingGate } from './http/ringGate.js';
import { serveWeb } from './http/web.js';
import { createRoutes, writers } from './http/routes.js';
import { allowedPeer, allowedRequest, appOrigin, requester } from './http/access.js';
import { Host } from './host/client.js';
import { createPresence, isPhone } from './presence.js';
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
type Client = { send: (m: ServerMessage) => void; sendRaw: (data: string, id?: number) => void; view: string; waiting?: boolean; close?: () => void; phone?: boolean };
const presence = createPresence();
let presenceSent = 0;
// Tells the host a desktop client is active, at most every 5 s.
function touchDesktop(client: Client) {
  if (client.phone) return;
  presence.touch();
  if (presence.at() - presenceSent < 5_000) return;
  presenceSent = presence.at();
  host.notify({ op: 'desktop', at: presence.at() });
}
const BOOT = Date.now();
// serve.sh leaves this when the web build fails and the previous build is served.
const BUILD_FAILED = path.join(os.homedir(), '.agentview', 'web-build-failed');
const clients = new Set<Client>();
const STALL_MS = 60_000;
const streams = new Map<string, Client>();
const ring = new Ring();
const gate = new RingGate(ring, (chat) => [...clients].some((c) => c.view === chat));
let chats = new Map<string, LiveChat>();
let lastViewed = '';
let restarting = false;

// To every client, or to the viewers of one chat. Each broadcast gets an id so an event stream can resume.
function broadcast(m: ServerMessage, chat: string | null = null) {
  const data = JSON.stringify(m);
  const id = gate.push(m.type === 'init' ? null : data, chat);
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
  const old = client.view;
  client.view = id;
  if (old !== id) gate.leave(old);
  gate.attach(id);
  client.waiting = true;
  lastViewed = id;
  reportViewers();
  host.call({ op: 'state', id, limit: ROW_WINDOW }, (err, state) => {
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

const { dispatch } = createRoutes({
  host,
  chats: () => chats,
  lastViewed: () => lastViewed,
  bySession,
  closeByUser,
  restart,
  streams,
  handleCommand,
  openEvents,
  attentionSources,
  serveWeb,
  allowedPeer,
  requester,
  thisMac,
  networkInterfaces: os.networkInterfaces,
  PORT,
  APK,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const { json } = writers(req, res);
  if (!allowedRequest(req.headers, requester(req))) return json({ error: 'Forbidden' }, 403);
  const app = appOrigin(req.headers, requester(req));
  if (app) {
    res.setHeader('access-control-allow-origin', app);
    res.setHeader('vary', 'origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, last-event-id',
        'access-control-max-age': '600',
        ...(req.headers['access-control-request-private-network'] && { 'access-control-allow-private-network': 'true' }),
      });
      return res.end();
    }
  }
  await dispatch(req, res, url);
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
  const client: Client = { send: (m) => sendRaw(JSON.stringify(m)), sendRaw, view: chat, phone: isPhone(params.get('client'), req.headers['user-agent']) };
  clients.add(client);
  touchDesktop(client);
  view(client, chat);
  // A phone coming back after its chat was idle-closed should get that chat back, not whatever was viewed last.
  const wanted = params.get('session');
  if (wanted && chats.get(chat)?.sessionId !== wanted) host.req<string>({ op: 'open', sessionId: wanted }).then((c) => client.view === chat && view(client, c), () => {});
  client.send({ type: 'live', chats: [...chats.values()] });
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
    gate.leave(client.view);
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
  const client: Client = { send: (m) => client.sendRaw(JSON.stringify(m), ring.seq), sendRaw: (data, id) => write(frame(data, id)), view: chat, close: () => res.destroy(), phone: isPhone(url.searchParams.get('client'), req.headers['user-agent']) };
  clients.add(client);
  touchDesktop(client);
  streams.set(cid, client);
  const missed = found ? ring.since(Number(req.headers['last-event-id'] ?? url.searchParams.get('last')), chat) : null;
  if (missed) {
    client.view = chat;
    for (const e of missed) client.sendRaw(e.data, e.id);
    reportViewers();
  } else view(client, chat);
  gate.attach(chat);
  const wanted = url.searchParams.get('session');
  if (wanted && chats.get(chat)?.sessionId !== wanted) host.req<string>({ op: 'open', sessionId: wanted }).then((c) => client.view === chat && view(client, c), () => {});
  client.send({ type: 'live', chats: [...chats.values()] });
  client.send({ type: 'attention', items: attention() });
  if (restarting) client.send({ type: 'restarting' });
  // A named event, not a comment: the client hears it and can tell a dead link from a quiet one.
  const ping = setInterval(() => (stalled && Date.now() - stalled > STALL_MS ? res.destroy() : write('event: ping\ndata:\n\n')), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
    gate.leave(client.view);
    if (streams.get(cid) === client) streams.delete(cid);
    reportViewers();
  });
}

function handleCommand(client: Client, msg: ClientMessage, target?: string) {
  touchDesktop(client);
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
      if (msg.profile === 'work') mkdirSync(CODEX_WORK, { recursive: true });
      host.req<string>({ op: 'new', cwd: msg.profile === 'work' ? CODEX_WORK : msg.profile === 'personal' ? PROJECT : msg.cwd ?? chats.get(client.view)?.cwd ?? PROJECT, from: client.view, ...(typeof msg.fork === 'string' && { fork: msg.fork }) }).then((c) => view(client, c), fail);
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
