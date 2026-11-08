import { execFile } from 'node:child_process';
import type http from 'node:http';
import type os from 'node:os';
import { readFile } from 'node:fs/promises';
import { closeTerminal, createTerminal, listTerminals } from '../workspace/terminal.js';
import { openInChrome } from '../chrome/chrome.js';
import { listSessions, renameRoute, savedSession } from '../agent/claude/sessions.js';
import { cancelFocus, scheduleFocus } from '../integrations/focus.js';
import { configDef, connectorStatus, inSettings, mcpCall, mcpConfig, mcpGroups, mcpProbe, setMcpGroup } from '../agent/claude/mcp.js';
import type { McpServerDef } from '../integrations/mcpClient.js';
import { emptyBin, listBin, restoreSession } from '../agent/claude/bin.js';
import { pinsRoute, removeChat } from '../agent/claude/pins.js';
import { seenRoute } from '../agent/claude/seen.js';
import { listDir, listFiles, readFileWithOriginal, readImage, writeFileText } from '../workspace/files.js';
import { github } from '../integrations/github.js';
import { assistantRoute } from '../integrations/assistant.js';
import { attention, dismissAttention, refreshAttention, type Sources } from '../integrations/attention.js';
import { dismissFinding, getFindings } from '../session/findings.js';
import { deployRoute } from '../integrations/deploy.js';
import { linkTitleRoute } from '../integrations/linkTitle.js';
import { gitRoute } from '../workspace/git.js';
import { observe } from '../integrations/observe.js';
import { otherMacs } from './macs.js';
import { createFolder, createWorktree, listRepos, listWorktrees, removeWorktree } from '../workspace/worktrees.js';
import type { ClientMessage, LiveChat } from '../../../shared/protocol.js';
import { gz } from './web.js';
import { readBody, savePaste } from './body.js';
import type { Host } from '../host/client.js';
import { isPhone } from '../presence.js';

const MAX_FILE_BODY = 5_000_000;

export const HANDLED = Symbol('handled');

export type CommandClient = { send: (m: any) => void; sendRaw: (data: string, id?: number) => void; view: string; phone?: boolean };

export type RouteDeps = {
  host: Pick<Host, 'notify' | 'req'>;
  chats: () => Map<string, LiveChat>;
  lastViewed: () => string;
  bySession: (sessionId: string | null) => string | undefined;
  closeByUser: (id: string) => Promise<void>;
  restart: (now: boolean, full: boolean) => void;
  streams: { get: (cid: string) => CommandClient | undefined };
  handleCommand: (client: CommandClient, msg: ClientMessage, target?: string) => void;
  openEvents: (req: http.IncomingMessage, res: http.ServerResponse, url: URL, chat: string, found?: boolean) => void;
  attentionSources: (extra?: string[]) => Sources;
  serveWeb: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<boolean>;
  allowedPeer: (addr?: string) => boolean;
  requester: (req: http.IncomingMessage) => string;
  thisMac: string;
  networkInterfaces: typeof os.networkInterfaces;
  PORT: number;
  APK: string;
};

type Ctx = { req: http.IncomingMessage; res: http.ServerResponse; url: URL; method: string; body: any };
type ChatCtx = Ctx & { chat: LiveChat };
type Reply = { status: number; body: unknown } | { status: number; text: string };
type Entry<C> = { run: (c: C) => unknown; body?: boolean | string };
type Prefix<C> = Entry<C> & { prefix: string };

const isReply = (v: unknown): v is Reply => typeof v === 'object' && v !== null && 'status' in v && ('body' in v || 'text' in v);

export function writers(req: http.IncomingMessage, res: http.ServerResponse) {
  const jsonText = async (text: string, code = 200) => {
    if (text.length < 1024 || !/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      res.writeHead(code, { 'content-type': 'application/json' });
      return res.end(text);
    }
    const out = await gz(text);
    res.writeHead(code, { 'content-type': 'application/json', 'content-encoding': 'gzip', vary: 'accept-encoding, origin' });
    res.end(out);
  };
  const json = (body: unknown, code = 200) => jsonText(JSON.stringify(body), code);
  return { json, jsonText };
}

const entry = <C>(run: Entry<C>['run'], body?: Entry<C>['body']): Entry<C> => ({ run, body });

export function createRoutes(d: RouteDeps) {
  const liveCwds = () => [...d.chats().values()].map((c) => c.cwd);

  const open: Record<string, Entry<Ctx>> = {
    'ANY /api/link-title': entry(({ url }) => linkTitleRoute(url)),
    'DELETE /api/sessions': entry(async ({ url }) => {
      const id = url.searchParams.get('id') ?? '';
      const opened = d.bySession(id);
      if (opened) await d.closeByUser(opened);
      return removeChat(id, url.searchParams.has('purge'), url.searchParams.has('archive'));
    }),
    'POST /api/sessions/rename': entry(async ({ url, body }) => {
      const id = url.searchParams.get('id');
      const r = await renameRoute(id, body.title);
      if (r.status === 200) d.host.notify({ op: 'rename', sessionId: id!, title: body.title.trim() });
      return r;
    }, true),
    'ANY /api/sessions/pins': entry(({ method, url }) => pinsRoute(method, url.searchParams.get('id'))),
    'ANY /api/sessions/seen': entry(({ method, url }) => seenRoute(method, url.searchParams.get('id'))),
    'DELETE /api/sessions/bin': entry(async () => {
      await emptyBin();
      return { ok: true };
    }),
    'ANY /api/sessions/bin': entry(() => listBin()),
    'POST /api/sessions/restore': entry(async ({ url }) => {
      await restoreSession(url.searchParams.get('id') ?? '');
      return { ok: true };
    }),
    'DELETE /api/worktrees': entry(async ({ url }) => {
      await removeWorktree(url.searchParams.get('id') ?? '', liveCwds());
      return { ok: true };
    }),
    'POST /api/worktrees': entry(async ({ body }) => ({ cwd: await createWorktree(String(body.repo ?? ''), String(body.branch ?? '').trim()) }), true),
    'POST /api/paste': entry(async ({ req, url }) => ({ path: await savePaste(req, url.searchParams.get('name') ?? '') })),
    'POST /api/folders': entry(async ({ body }) => ({ cwd: await createFolder(String(body.root ?? ''), String(body.name ?? '').trim()) }), true),
    'POST /api/open': entry(({ body }) => {
      const target = String(body.url ?? '');
      if (!/^https?:\/\//.test(target)) return { status: 400, body: { error: 'Only http(s) links open' } };
      if (body.browser === 'firefox' && process.platform === 'darwin') execFile('open', ['-a', 'Firefox', target], (err) => err && console.error('open in firefox:', err.message));
      else openInChrome(target);
      return { ok: true };
    }, true),
    'ANY /api/mcp/connectors': entry(({ url }) => connectorStatus(url.searchParams.has('refresh'))),
    'POST /api/mcp/groups': entry(async ({ body }) => {
      const service = String(body.service ?? '').trim();
      if (!service) return { status: 400, body: { error: 'service is required' } };
      return setMcpGroup(service, String(body.group ?? ''));
    }, true),
    'ANY /api/mcp/groups': entry(() => mcpGroups()),
    'POST /api/restart': entry(({ url }) => {
      d.restart(url.searchParams.has('now'), url.searchParams.has('full'));
      return { ok: true };
    }),
    'ANY /api/app': entry(async () => ({ build: Number(await readFile(`${d.APK}.txt`, 'utf8').catch(() => '0')) || 0 })),
    'ANY /api/app.apk': entry(async ({ res }) => {
      const body = await readFile(d.APK);
      res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename="AgentView.apk"' });
      res.end(body);
      return HANDLED;
    }),
    'ANY /api/connect': entry(async ({ req, url }) => {
      const port = [url.searchParams.get('port'), req.headers.host?.match(/:(\d+)$/)?.[1]].find((p) => p && /^\d{1,5}$/.test(p)) ?? String(d.PORT);
      const ips = Object.values(d.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal && d.allowedPeer(a.address))
        .map((a) => a!.address);
      const running = [...d.chats().values()].filter((c) => c.running).length;
      const { macs, problem } = url.searchParams.has('peer') ? { macs: [] } : await otherMacs(port, d.requester(req));
      return { hostname: d.thisMac, urls: ips.map((ip) => `http://${ip}:${port}`), running, macs, netbird: problem };
    }),
    'ANY /api/sessions': entry(async () => {
      const [list, bin] = await Promise.all([listSessions({ limit: 300 }), listBin()]);
      const binned = new Set(bin.map((b) => b.sessionId));
      return list.filter((x) => !binned.has(x.sessionId)).map(savedSession);
    }),
    'POST /api/focus': entry(({ body }) => {
      const r = scheduleFocus(body?.title, body?.end);
      return 'error' in r ? { status: 400, body: r } : r;
    }, true),
    'DELETE /api/focus': entry(() => {
      cancelFocus();
      return { ok: true };
    }),
    'ANY /api/worktrees': entry(() => listWorktrees(liveCwds())),
    'ANY /api/repos': entry(() => listRepos()),
  };

  const openPrefixes: Prefix<Ctx>[] = [
    { prefix: '/api/assistant/', run: ({ method, url, req }) => assistantRoute(method, url, () => readBody(req, 5_000_000)) },
  ];

  const chatRoutes: Record<string, Entry<ChatCtx>> = {
    'ANY /api/events': entry(({ req, res, url, chat }) => {
      const asked = (url.searchParams.has('session') && d.bySession(url.searchParams.get('session'))) || (d.chats().has(url.searchParams.get('chat') ?? '') ? url.searchParams.get('chat')! : undefined);
      d.openEvents(req, res, url, asked ?? chat.id, Boolean(asked));
      return HANDLED;
    }),
    'POST /api/cmd': entry(({ req, url, body, chat }) => {
      const msg = body as ClientMessage;
      if (typeof msg?.type !== 'string') throw new Error('Bad command');
      const client = d.streams.get(url.searchParams.get('cid') ?? '');
      if (!client && !d.chats().has(url.searchParams.get('chat') ?? '')) return { status: 409, body: { error: 'No stream for this command' } };
      d.handleCommand(client ?? { send: () => {}, sendRaw: () => {}, view: chat.id, phone: isPhone(url.searchParams.get('client'), req.headers['user-agent']) }, msg, url.searchParams.get('chat') || undefined);
      return { ok: true };
    }, true),
    'POST /api/terms': entry(({ chat }) => createTerminal(chat.id, chat.cwd)),
    'DELETE /api/terms': entry(({ url }) => closeTerminal(url.searchParams.get('id') ?? '')),
    'ANY /api/terms': entry(({ chat }) => listTerminals(chat.id)),
    'ANY /api/files': entry(({ chat }) => listFiles(chat.cwd)),
    'ANY /api/dir': entry(({ url, chat }) => listDir(chat.cwd, url.searchParams.get('path') ?? '')),
    'PUT /api/file': entry(async ({ req, url, chat }) => writeFileText(chat.cwd, url.searchParams.get('path') ?? '', await readBody(req, MAX_FILE_BODY))),
    'ANY /api/file': entry(({ url, chat }) => readFileWithOriginal(chat.cwd, url.searchParams.get('path') ?? '')),
    'ANY /api/image': entry(async ({ res, url, chat }) => {
      const img = await readImage(chat.cwd, url.searchParams.get('path') ?? '');
      res.writeHead(200, { 'content-type': img.type, 'cache-control': 'no-cache', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' });
      res.end(img.body);
      return HANDLED;
    }),
    'ANY /api/mcp/config': entry(({ chat }) => mcpConfig(chat.cwd)),
    'POST /api/mcp/add': entry(async ({ url, chat }) => {
      const name = url.searchParams.get('name') ?? '';
      if (!(await configDef(chat.cwd, name))) return { status: 404, body: { error: `${name} is not in your MCP config` } };
      return d.host.req({ op: 'mcp_add', id: chat.id, name });
    }),
    'POST /api/mcp/login': entry(async ({ url, chat }) => {
      const r = await d.host.req<{ authUrl?: string }>({ op: 'mcp_login', id: chat.id, name: url.searchParams.get('name') ?? '' });
      if (r.authUrl) openInChrome(r.authUrl);
      return r;
    }),
    'ANY /api/mcp/probe': entry(({ url, chat }) => mcpProbe(chat.cwd, url.searchParams.has('refresh'))),
    'POST /api/mcp/call': entry(async ({ body, chat }) => {
      const name = String(body.server ?? '');
      const def = await configDef(chat.cwd, name);
      if (!def) return { status: 404, body: { error: `${name} is not in your MCP config` } };
      if (!(await inSettings(chat.cwd, name))) return { status: 403, body: { error: `${name} is not approved in Claude Code, so AgentView does not start it` } };
      const r = await mcpCall(chat.cwd, name, def as McpServerDef, String(body.tool ?? ''), body.args ?? {});
      return { status: 'error' in r ? 400 : 200, body: r };
    }, true),
    'ANY /api/chat/events': entry(async ({ url, chat }) => {
      const limit = parseInt(url.searchParams.get('limit') ?? '', 10);
      try {
        return await d.host.req({ op: 'events_before', id: chat.id, before: url.searchParams.get('before') ?? '', ...(!Number.isNaN(limit) && { limit }) });
      } catch (err) {
        return { status: 404, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }),
    'ANY /api/state': entry(({ chat }) => d.host.req({ op: 'state', id: chat.id })),
    'ANY /api/attention': entry(({ url, chat }) => (url.searchParams.has('fresh') ? refreshAttention(d.attentionSources([chat.cwd])) : attention())),
    'ANY /api/findings': entry(({ url, chat }) => getFindings(chat.cwd, url.searchParams.get('target') ?? 'local')),
    'POST /api/findings/dismiss': entry(({ body, chat }) => dismissFinding(chat.cwd, String(body.target ?? 'local'), String(body.key ?? '')), true),
    'POST /api/attention/dismiss': entry(({ body }) => dismissAttention(String(body.id ?? '')), true),
    'POST /api/attention/ask': entry(async ({ body, chat }) => {
      const item = attention().find((it) => it.id === body.id);
      if (!item) throw new Error('That item is gone');
      return { id: await d.host.req<string>({ op: 'ask', cwd: item.cwd, prompt: item.prompt, from: chat.id }) };
    }, true),
  };

  const chatPrefixes: Prefix<ChatCtx>[] = [
    { prefix: '/api/git/', run: ({ url, chat, body }) => gitRoute(chat.cwd, url.pathname.slice(9), url.searchParams, body), body: 'POST' },
    { prefix: '/api/observe', run: ({ req, url, chat }) => observe(req, url, chat.cwd) },
    { prefix: '/api/gh/', run: ({ req, method, url, chat }) => github(chat.cwd, method, url, () => readBody(req)) },
    { prefix: '/api/deploy/', run: ({ req, method, url, chat }) => deployRoute(chat.cwd, method, url, () => readBody(req)) },
  ];

  function find<C>(table: Record<string, Entry<C>>, prefixes: Prefix<C>[], method: string, path: string) {
    return table[`${method} ${path}`] ?? table[`ANY ${path}`] ?? prefixes.find((p) => path.startsWith(p.prefix));
  }

  async function dispatch(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const { json, jsonText } = writers(req, res);
    const method = req.method ?? 'GET';
    try {
      const ctx: Ctx = { req, res, url, method, body: null };
      const run = async <C extends Ctx>(e: Entry<C>, c: C) => {
        if (e.body === true || e.body === method) c.body = JSON.parse(await readBody(req));
        const out = await e.run(c);
        if (out === HANDLED) return;
        if (!isReply(out)) return json(out);
        return 'text' in out ? jsonText(out.text, out.status) : json(out.body, out.status);
      };
      const free = find(open, openPrefixes, method, url.pathname);
      if (free) return await run(free, ctx);
      const chat = d.chats().get(url.searchParams.get('chat') ?? '') ?? d.chats().get(d.lastViewed());
      if (!chat) return await json({ error: 'The agent host is starting' }, 503);
      const mine = find(chatRoutes, chatPrefixes, method, url.pathname);
      if (mine) return await run(mine, { ...ctx, chat });
      if (!(await d.serveWeb(req, res, url))) return await json({ error: 'web client not built, run npm run dev or npm run build' }, 404);
    } catch (err) {
      await json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  return { dispatch };
}
