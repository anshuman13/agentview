import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { attachTerminal, closeTerminals } from './workspace/terminal.js';
import { connect as connectChrome, openChrome, ownProfile } from './chrome/chrome.js';
import { ADVISORS_ELSEWHERE, STARTED_ON_HUB, advisorsMac, askAdvisorsMac } from './integrations/assistant.js';
import { ntfyTopic, post } from './integrations/notify.js';
import { CODEX_WORK } from './workspace/files.js';
import { createAutoMerge } from './integrations/automerge.js';
import { forgetPrs, gh, useAutoMerge } from './integrations/github.js';
import { onAttention, startAttention } from './integrations/attention.js';
import { thisMac } from './http/macs.js';
import type { AttentionItem, ClientMessage } from '../../shared/protocol.js';
import { Ring, frame } from './http/stream.js';
import { createClients, type Client, type Live } from './http/clients.js';
import { serveWeb } from './http/web.js';
import { createRoutes, writers } from './http/routes.js';
import { OPEN, Peer, type SocketData } from './http/peer.js';
import { allowedPeer, allowedRequest, appOrigin, requester } from './http/access.js';
import { Host } from './host/client.js';
import { migrateSettings } from './migrateSettings.js';
import { applyAccountLabels, expandHome, homeRelative } from './settings.js';
import { createPresence, isPhone } from './presence.js';
import type { Hello } from './host/protocol.js';

const PORT = Number(process.env.PORT ?? 7777);
const here = path.dirname(fileURLToPath(import.meta.url));
// Without a folder given, chats start in the repo root, not in server/ where the start scripts run.
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? path.join(here, '../..'));
const APK = path.resolve(here, '../../dist/AgentView.apk');

if (ownProfile()) {
  process.env.BROWSER = path.resolve(here, '../browser.sh');
  process.env.AGENTVIEW_PORT = String(PORT);
}

process.on('uncaughtException', (err) => console.error('uncaught:', err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err));
// A signal skips the exit event, which stops the MCP servers in their own process groups; exit so it runs.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => process.exit(0));

// The chats live in the agent host (host/main.ts); this process serves the web client and relays to it.
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
const STALL_MS = 60_000;
const MAX_QUEUED = 32 * 1024 * 1024;
const streams = new Map<string, Client>();
const ring = new Ring();
const live: Live = { chats: new Map(), runs: [], lastViewed: '', restarting: false };

const bySession = (sessionId: string | null) => [...live.chats.values()].find((c) => c.sessionId === sessionId)?.id;

async function closeByUser(id: string) {
  const next = await host.req<string>({ op: 'close', id });
  if (live.lastViewed === id) live.lastViewed = next;
  for (const c of clients) if (c.view === id) view(c, next);
}

const host = new Host(PORT, PROJECT, {
  push: (l) => {
    if ('closed' in l) return closeTerminals(l.closed);
    if (l.m.type === 'live') live.chats = new Map(l.m.chats.map((c) => [c.id, c]));
    if (l.m.type === 'restarting') live.restarting = true;
    if (l.m.type === 'runs') {
      live.runs = l.m.runs;
      return broadcast(runsMessage());
    }
    broadcast(l.m, l.chat);
  },
  up: () => host.call({ op: 'hello' }, (err, r) => {
    if (err) return;
    const hello = r as Hello;
    const before = live.chats;
    live.chats = new Map(hello.chats.map((c) => [c.id, c]));
    live.runs = hello.runs ?? [];
    live.restarting = hello.restarting;
    live.lastViewed = live.chats.has(live.lastViewed) ? live.lastViewed : hello.last;
    // After a host restart the chats come back under new ids; a client follows its chat by session id.
    for (const c of clients) view(c, live.chats.has(c.view) ? c.view : (bySession(before.get(c.view)?.sessionId ?? null) ?? live.lastViewed));
    broadcast({ type: 'live', chats: hello.chats });
    broadcast(runsMessage());
    // A new host starts with no viewers, an old one with counts from before; tell it who watches now.
    reportViewers();
    // A host still running older code restarts once its turns end.
    if (!live.restarting) host.call({ op: 'restart', now: false, force: false });
  }),
  down: () => {
    if (!live.restarting) broadcast({ type: 'restarting' });
    live.restarting = true;
  },
});

const { clients, gate, runsMessage, broadcast, reportViewers, view, greet } = createClients(host, live, ring, BOOT);

// Restarts this server at once; the host and its chats keep running unless its code changed or `full` asks for it.
function restart(now: boolean, full: boolean) {
  host.call({ op: 'restart', now, force: full }, () => setTimeout(() => process.exit(0), 100));
}

onAttention((items) => broadcast({ type: 'attention', items }));
function attentionSources(extra: string[] = []) {
  const all = [...live.chats.values()];
  const idle = all.filter((c) => !c.running && !c.pending && c.edits);
  return {
    cwds: [...new Set([...all.map((c) => c.cwd), ...extra])],
    edited: idle.map((c) => ({ cwd: c.cwd, chatId: c.id, at: c.lastActive })).sort((a, b) => b.at - a.at),
  };
}
const fixChat = (item: AttentionItem) => host.req<string>({ op: 'ask', cwd: item.cwd, prompt: item.prompt, fresh: true });
startAttention(attentionSources, fixChat);
const autoMerge = createAutoMerge({ gh, post, file: path.join(os.homedir(), '.agentview/automerge.json'), changed: forgetPrs });
useAutoMerge(autoMerge);
autoMerge.start();

const { dispatch } = createRoutes({
  host,
  chats: () => live.chats,
  runs: () => live.runs,
  lastViewed: () => live.lastViewed,
  bySession,
  closeByUser,
  restart,
  streams,
  handleCommand,
  openEvents,
  attentionSources,
  serveWeb,
  allowedPeer,
  thisMac,
  networkInterfaces: os.networkInterfaces,
  PORT,
  APK,
});

async function handle(req: Request, server: Bun.Server<SocketData>): Promise<Response | undefined> {
  const addr = server.requestIP(req)?.address;
  // Only this Mac and NetBird peers; Bun.serve has no hook before the request, so each request is checked.
  if (!allowedPeer(addr)) return new Response(null, { status: 403 });
  const ip = requester(addr, req.headers.get('x-forwarded-for'));
  const headers = Object.fromEntries(req.headers);
  if (!allowedRequest(headers, ip)) return writers(req).json({ error: 'Forbidden' }, 403);
  const url = new URL(req.url);
  // Hub syncs, git pushes and worktree creation may run past the 255 s idle limit; their own timeouts end them.
  if (req.method === 'POST') server.timeout(req, 0);
  if (url.pathname === '/ws') {
    const data: SocketData = { url: req.url, origin: headers.origin, agent: headers['user-agent'] };
    return server.upgrade(req, { data }) ? undefined : new Response('Expected a WebSocket upgrade', { status: 400 });
  }
  const app = appOrigin(headers, ip);
  if (app && req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': app,
        vary: 'origin',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, last-event-id',
        'access-control-max-age': '600',
        ...(headers['access-control-request-private-network'] && { 'access-control-allow-private-network': 'true' }),
      },
    });
  }
  const res = await dispatch(req, url, ip);
  if (app) {
    res.headers.set('access-control-allow-origin', app);
    res.headers.set('vary', [res.headers.get('vary'), 'origin'].filter(Boolean).join(', '));
  }
  return res;
}

// Phones that drop off the VPN leave half-open sockets; without this they count as viewers for hours.
const sockets = new Set<Peer>();
const alive = new WeakSet<Peer>();
const missed = new WeakMap<Peer, number>();
setInterval(() => {
  for (const ws of sockets) {
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

function openSocket(ws: Peer, data: SocketData) {
  sockets.add(ws);
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  ws.on('close', () => sockets.delete(ws));
  const params = new URL(data.url).searchParams;
  const term = params.get('term');
  if (term !== null) return attachTerminal(ws, term);
  if (params.has('chrome')) return openChrome(ws, data.origin);
  const chat = (live.chats.has(params.get('chat') ?? '') ? params.get('chat')! : undefined) ?? (params.has('session') ? bySession(params.get('session')) : undefined) ?? live.lastViewed;
  const sendRaw = (text: string) => ws.readyState === OPEN && ws.send(text);
  const client: Client = { send: (m) => sendRaw(JSON.stringify(m)), sendRaw, view: chat, phone: isPhone(params.get('client'), data.agent) };
  clients.add(client);
  touchDesktop(client);
  view(client, chat);
  greet(client, chat, params.get('session'));

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
}

// Server-Sent Events: the same ServerMessage stream as /ws, resumable from Last-Event-ID through the ring buffer.
// The browser's own reconnect sends Last-Event-ID; the last param in its URL is from the first connect and stale by then.
// found: the stream asked for a chat that exists, so a resume may replay deltas; otherwise it gets a full init.
function openEvents(req: Request, url: URL, chat: string, found = true) {
  server.timeout(req, 0);
  const cid = url.searchParams.get('cid') || randomUUID();
  // A tab that reopens its stream replaces the old one, which may be a half-open socket that would count as a viewer for hours.
  streams.get(cid)?.close?.();
  // Bytes the socket has not taken yet count against this; a write past it that does not drain for a minute means
  // a half-open socket (a phone that left the VPN), which is no viewer.
  let out!: ReadableStreamDefaultController<Uint8Array>;
  let stalled = 0;
  let ended = false;
  const bytes = new TextEncoder();
  const write = (data: string) => {
    if (ended) return;
    out.enqueue(bytes.encode(data));
    const room = out.desiredSize ?? 0;
    if (room <= 0) stalled ||= Date.now();
    // Closing does not free the bytes already queued, so a stream stuck this far behind ends before it holds more.
    // A live client reconnects and resumes from the ring buffer.
    if (room < -MAX_QUEUED && Date.now() - stalled > 10_000) close();
  };
  const end = () => {
    if (ended) return;
    ended = true;
    clearInterval(ping);
    clients.delete(client);
    gate.leave(client.view);
    if (streams.get(cid) === client) streams.delete(cid);
    reportViewers();
  };
  const close = () => {
    const was = ended;
    end();
    if (!was) out.close();
  };
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (out = c), pull: () => void (stalled = 0), cancel: end }, { highWaterMark: 256_000, size: (c) => c!.byteLength });
  req.signal.addEventListener('abort', end);
  const client: Client = { send: (m) => client.sendRaw(JSON.stringify(m), ring.seq), sendRaw: (data, id) => write(frame(data, id)), view: chat, close, phone: isPhone(url.searchParams.get('client'), req.headers.get('user-agent') ?? undefined) };
  clients.add(client);
  touchDesktop(client);
  streams.set(cid, client);
  const missed = found ? ring.since(Number(req.headers.get('last-event-id') ?? url.searchParams.get('last')), chat) : null;
  if (missed) {
    client.view = chat;
    for (const e of missed) client.sendRaw(e.data, e.id);
    reportViewers();
  } else view(client, chat);
  gate.attach(chat);
  greet(client, chat, url.searchParams.get('session'));
  // A named event, not a comment: the client hears it and can tell a dead link from a quiet one.
  const ping = setInterval(() => (stalled && Date.now() - stalled > STALL_MS ? close() : write('event: ping\ndata:\n\n')), 20_000);
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' } });
}

function handleCommand(client: Client, msg: ClientMessage, target?: string) {
  touchDesktop(client);
  const fail = (err: unknown) => client.send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
  switch (msg.type) {
    case 'close':
      if (live.chats.has(msg.id)) closeByUser(msg.id).catch(fail);
      break;
    case 'view':
      if (live.chats.has(msg.id)) view(client, msg.id);
      else fail(new Error('This chat was closed'));
      break;
    case 'open_session':
      host.req<string>({ op: 'open', sessionId: msg.sessionId }).then((c) => view(client, c), fail);
      break;
    case 'open_advisor':
      // Advisors live on the hub Mac: a prompt goes there, opening one is only possible there.
      if (advisorsMac() && msg.text) void askAdvisorsMac('/api/cmd', { method: 'POST', body: msg }).then((r) => fail(new Error(r.status === 200 ? STARTED_ON_HUB : String((r.body as { error?: string }).error))));
      else if (advisorsMac()) fail(new Error(ADVISORS_ELSEWHERE));
      else host.req<string>({ op: 'advisor', id: msg.id, fresh: Boolean(msg.fresh), ...(typeof msg.text === 'string' && msg.text && { text: msg.text }) }).then((c) => view(client, c), fail);
      break;
    case 'new_session':
      if (msg.hub && advisorsMac() && msg.cwd) {
        void askAdvisorsMac('/api/cmd', { method: 'POST', body: { ...msg, cwd: homeRelative(msg.cwd), hub: false } }).then((r) => fail(new Error(r.status === 200 ? STARTED_ON_HUB : String((r.body as { error?: string }).error))));
        break;
      }
      if (msg.profile === 'work') mkdirSync(CODEX_WORK, { recursive: true });
      host.req<string>({ op: 'new', cwd: msg.profile === 'work' ? CODEX_WORK : msg.profile === 'personal' ? PROJECT : (msg.cwd && expandHome(msg.cwd)) ?? live.chats.get(client.view)?.cwd ?? PROJECT, from: client.view, ...(typeof msg.fork === 'string' && { fork: msg.fork }), ...(typeof msg.model === 'string' && { model: msg.model }), ...(typeof msg.provider === 'string' && { provider: msg.provider }), ...(typeof msg.text === 'string' && msg.text && { text: msg.text }) }).then((c) => view(client, c), fail);
      break;
    case 'restart':
      restart(Boolean(msg.now), false);
      break;
    default: {
      const id = ('run' in msg ? live.runs.find((r) => r.id === msg.run)?.chatId : undefined) ?? target ?? client.view;
      // No pre-check against live.chats: the host's live broadcast is debounced, so a prompt sent right after a new
      // chat's init would be dropped. The host itself answers "This chat was closed" for an unknown id.
      host.req({ op: 'cmd', id, msg }).catch(fail);
    }
  }
}

let server: Bun.Server<SocketData>;
try {
  server = Bun.serve<SocketData>({
    port: PORT,
    hostname: '::',
    // Seconds a request may go without traffic; some routes wait on the agent host for up to a minute.
    idleTimeout: 255,
    maxRequestBodySize: 64_000_000,
    fetch: handle,
    websocket: {
      maxPayloadLength: 8_000_000,
      perMessageDeflate: true,
      // The ping loop above closes dead sockets.
      idleTimeout: 0,
      sendPings: false,
      open: (ws) => openSocket((ws.data.peer = new Peer(ws)), ws.data),
      message: (ws, raw) => ws.data.peer!.message(raw),
      pong: (ws) => ws.data.peer!.pong(),
      drain: (ws) => ws.data.peer!.drain(),
      close: (ws) => ws.data.peer!.closed(),
    },
    error: (err) => {
      console.error('request:', err);
      return Response.json({ error: err.message }, { status: 500 });
    },
  });
} catch (err) {
  // Without its port this process is useless; the menu bar app starts it again.
  console.error(err);
  process.exit(1);
}
console.log(`agentview on http://localhost:${PORT} for ${PROJECT}`);
if (existsSync(BUILD_FAILED)) post('The AgentView web build failed', 'Serving the previous build', 'See ~/.agentview/logs/server.log');

// The web app used to be on :5173; send old bookmarks and phone shells here.
if (PORT === 7777 && !process.env.AGENTVIEW_DEV_WEB) {
  try {
    Bun.serve({
      port: 5173,
      hostname: '::',
      fetch: (req) => {
        const url = new URL(req.url);
        return new Response(null, { status: 301, headers: { location: `http://${url.hostname}:${PORT}${url.pathname}${url.search}` } });
      },
    });
  } catch {}
}
void ntfyTopic().then((t) => console.log(t === 'off' ? 'push off' : 'push on, the ntfy topic is in ~/.agentview/observe.json'));
void connectChrome();
void migrateSettings().then(applyAccountLabels);
