import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdirSync, unlinkSync } from 'node:fs';
import { configDef } from '../agent/claude/mcp.js';
import { ownProfile } from '../chrome/chrome.js';
import { errText } from '../../../shared/util.js';
import { applyInitialModel } from './initialModel.js';
import { command } from './commands.js';
import { closeByUser, createChat, newChat, openSaved, prompt } from './chats.js';
import { liveList, broadcastLive, runs } from './listing.js';
import { sweepIdle, restart } from './lifecycle.js';
import { LAST, remember, saveAndExit } from './persist.js';
import { restoreChats } from './restoreChats.js';
import { PORT, PROJECT, SOCK, apis, bySession, get, hub, live, viewers } from './state.js';
import { lines, type Hello, type HostRequest } from './protocol.js';
import { readJson } from '../json.js';
import { applyAccountLabels } from '../settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));

if (ownProfile()) {
  process.env.BROWSER = path.resolve(here, '../../browser.sh');
  process.env.AGENTVIEW_PORT = String(PORT);
}

process.on('uncaughtException', (err) => console.error('uncaught:', err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err));

const served = () =>
  new Promise<boolean>((ok) => {
    const probe = net.connect(SOCK).on('connect', () => { probe.destroy(); ok(true); }).on('error', () => ok(false));
  });
// Another host already serving this port's socket keeps it; this one leaves.
if (await served()) process.exit(0);

applyAccountLabels();
sweepIdle();
process.on('SIGTERM', saveAndExit);
process.on('SIGINT', saveAndExit);

function renameChat(sessionId: string, title: string) {
  const chat = bySession(sessionId);
  if (!chat) return;
  chat.title = title;
  broadcastLive();
}

async function addMcp(id: string, name: string) {
  const chat = get(id);
  const def = await configDef(chat.cwd, name);
  if (!def) throw new Error(`${name} is not in your MCP config`);
  return chat.mcp.add(name, def);
}

function setViewers(counts: Record<string, number>, lastId: string) {
  hub.counts = counts;
  const last = live.get(lastId)?.chat;
  if (last) { hub.lastViewed = last; remember(last); }
  // A resumed chat starts its CLI once someone opens it, so the first prompt skips the cold start.
  for (const { chat } of live.values()) if (viewers(chat)) chat.start();
  broadcastLive();
}

async function handle(req: HostRequest): Promise<unknown> {
  switch (req.op) {
    case 'hello':
      await ready;
      return { last: hub.lastViewed.id, restarting: Boolean(hub.restarting), chats: liveList(), runs: runs.list() } satisfies Hello;
    case 'state':
      return get(req.id).view(req.limit);
    case 'events_before':
      return get(req.id).before(req.before, req.limit);
    case 'cmd':
      await command(get(req.id), req.msg);
      return null;
    case 'open':
      return (await openSaved(req.sessionId)).id;
    case 'new':
      return newInFolder(req);
    case 'close':
      return closeByUser(get(req.id));
    case 'rename':
      return renameChat(req.sessionId, req.title);
    case 'ask':
      return prompt(req.cwd, req.prompt, req.from, req.fresh);
    case 'mcp_add':
      return addMcp(req.id, req.name);
    case 'mcp_login':
      return get(req.id).mcp.login(req.name);
    case 'desktop':
      hub.desktopAt = req.at;
      return;
    case 'viewers':
      return setViewers(req.counts, req.last);
    case 'restart':
      return restart(req.now, req.force);
  }
}

async function newInFolder(req: Extract<HostRequest, { op: 'new' }>) {
  const chat = await newChat(req.cwd, get(req.from), req.fork, req.provider);
  applyInitialModel(chat, req.model);
  return chat.id;
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
    if (!apis.size) hub.counts = {};
  });
  sock.on('error', () => {});
});
// Two hosts can start at once; the one that loses the socket leaves before it opens any chat.
await new Promise<void>((ok) => {
  let retried = false;
  host
    .on('listening', () => {
      hub.serving = true;
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
hub.lastViewed = (await restoreChats().catch((err) => {
  console.error(`could not restore chats: ${errText(err)}`);
  return null;
})) ?? (await (last?.sessionId ? openSaved(last.sessionId).catch(() => createChat(PROJECT)) : createChat(PROJECT)));
markReady();
