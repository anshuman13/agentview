import { closeTerminal, createTerminal, listTerminals } from '../workspace/terminal.js';
import { openInChrome } from '../chrome/chrome.js';
import { configDef, inSettings, mcpCall, mcpConfig } from '../agent/claude/mcp.js';
import type { McpServerDef } from '../integrations/mcpClient.js';
import { provider } from '../agent/registry.js';
import { removeMemory, restoreMemory, saveMemory } from '../agent/memory.js';
import { deleteSketch, listDir, listFiles, listSketches, renameSketch, readFileWithOriginal, readImage, writeFileText } from '../workspace/files.js';
import { github } from '../integrations/github.js';
import { attention, dismissAttention, refreshAttention } from '../integrations/attention.js';
import { dismissFinding, getFindings } from '../session/findings.js';
import { deployRoute } from '../integrations/deploy.js';
import { deployUrl } from '../settings.js';
import { gitRoute } from '../workspace/git.js';
import type { ClientMessage } from '../../../shared/protocol.js';
import { readBody, failed } from '../json.js';
import { isPhone } from '../presence.js';
import { latestOf } from '../session/subChats.js';
import { currentChat, entry, type ChatCtx, type Ctx, type Entry, type Prefix, type RouteDeps } from './routeTypes.js';

const MAX_FILE_BODY = 5_000_000;

const refused = (err: unknown) => failed(400, err instanceof Error ? err.message : String(err));

// The stream and commands work with no chat open: a new chat is opened through them.
export function streamRoutes(d: RouteDeps): Record<string, Entry<Ctx>> {
  const current = (url: URL) => currentChat(d, url);
  return {
    'ANY /api/events': entry(async ({ req, url }) => {
      // Any session of a chat split by /clear stands for its latest sub-chat.
      const session = url.searchParams.get('session');
      if (session) url.searchParams.set('session', await latestOf(session));
      const asked = (session && d.bySession(url.searchParams.get('session'))) || (d.chats().has(url.searchParams.get('chat') ?? '') ? url.searchParams.get('chat')! : undefined);
      return d.openEvents(req, url, asked ?? current(url)?.id ?? '', Boolean(asked));
    }),
    'POST /api/cmd': entry(({ req, url, body }) => {
      const msg = body as ClientMessage;
      if (typeof msg?.type !== 'string') throw new Error('Bad command');
      const client = d.streams.get(url.searchParams.get('cid') ?? '');
      if (!client && !d.chats().has(url.searchParams.get('chat') ?? '') && msg.type !== 'new_session' && msg.type !== 'phone_alarm_result') return failed(409, 'No stream for this command');
      d.handleCommand(client ?? { send: () => {}, sendRaw: () => {}, view: current(url)?.id ?? '', phone: isPhone(url.searchParams.get('client'), req.headers.get('user-agent') ?? undefined), app: false, readOnly: false, opened: 0 }, msg, url.searchParams.get('chat') || undefined);
      return { ok: true };
    }, true),
  };
}

export function chatSessionRoutes(d: RouteDeps): Record<string, Entry<ChatCtx>> {
  return {
    'ANY /api/chat/events': entry(async ({ url, chat }) => {
      const limit = parseInt(url.searchParams.get('limit') ?? '', 10);
      try {
        return await d.host.req({ op: 'events_before', id: chat.id, before: url.searchParams.get('before') ?? '', ...(!Number.isNaN(limit) && { limit }) });
      } catch (err) {
        return failed(404, err instanceof Error ? err.message : String(err));
      }
    }),
    'ANY /api/state': entry(({ url, chat }) => {
      const limit = parseInt(url.searchParams.get('limit') ?? '', 10);
      return d.host.req({ op: 'state', id: chat.id, ...(!Number.isNaN(limit) && { limit }) });
    }),
    'ANY /api/attention': entry(({ url, chat }) => (url.searchParams.has('fresh') ? refreshAttention(d.attentionSources([chat.cwd])) : attention())),
    'ANY /api/memory': entry(({ chat }) => provider(chat.provider ?? 'claude').memory(chat.cwd)),
    'POST /api/memory/save': entry(async ({ body, chat }) => {
      if (typeof body.path !== 'string' || typeof body.text !== 'string') return failed(400, 'path and text are required');
      return saveMemory(await provider(chat.provider ?? 'claude').memory(chat.cwd), body.path, body.text).catch(refused);
    }, true),
    'POST /api/memory/remove': entry(async ({ body, chat }) => {
      if (typeof body.path !== 'string') return failed(400, 'path is required');
      return removeMemory(await provider(chat.provider ?? 'claude').memory(chat.cwd), body.path).catch(refused);
    }, true),
    'POST /api/memory/restore': entry(({ body, chat }) => {
      const { path: file, raw, lines } = body;
      if (typeof file !== 'string' || typeof raw !== 'string' || !Array.isArray(lines) || !lines.every((l) => typeof l === 'string')) return failed(400, 'path, raw and lines are required');
      return restoreMemory(provider(chat.provider ?? 'claude').memoryDirs(chat.cwd), file, raw, lines).catch(refused);
    }, true),
    'ANY /api/findings': entry(({ url, chat }) => getFindings(chat.cwd, url.searchParams.get('target') ?? 'local')),
    'POST /api/findings/dismiss': entry(({ body, chat }) => dismissFinding(chat.cwd, String(body.target ?? 'local'), String(body.key ?? '')), true),
    'POST /api/attention/dismiss': entry(({ body }) => dismissAttention(String(body.id ?? '')), true),
    'POST /api/attention/ask': entry(async ({ body, chat }) => {
      const item = attention().find((it) => it.id === body.id);
      if (!item) throw new Error('That item is gone');
      return { id: await d.host.req<string>({ op: 'ask', cwd: item.cwd, prompt: item.prompt, from: chat.id }) };
    }, true),
  };
}


export function chatFileRoutes(): Record<string, Entry<ChatCtx>> {
  return {
    'POST /api/terms': entry(({ chat }) => createTerminal(chat.id, chat.cwd)),
    'DELETE /api/terms': entry(({ url }) => closeTerminal(url.searchParams.get('id') ?? '')),
    'ANY /api/terms': entry(({ chat }) => listTerminals(chat.id)),
    'POST /api/sketches/rename': entry(({ url, chat }) => renameSketch(chat.cwd, url.searchParams.get('name') ?? '', url.searchParams.get('to') ?? '')),
    'DELETE /api/sketches': entry(({ url, chat }) => deleteSketch(chat.cwd, url.searchParams.get('name') ?? '')),
    'ANY /api/sketches': entry(({ chat }) => listSketches(chat.cwd)),
    'ANY /api/files': entry(({ chat }) => listFiles(chat.cwd)),
    'ANY /api/dir': entry(({ url, chat }) => listDir(chat.cwd, url.searchParams.get('path') ?? '')),
    'PUT /api/file': entry(async ({ req, url, chat }) => writeFileText(chat.cwd, url.searchParams.get('path') ?? '', await readBody(req, MAX_FILE_BODY))),
    'ANY /api/file': entry(({ url, chat }) => readFileWithOriginal(chat.cwd, url.searchParams.get('path') ?? '')),
    'ANY /api/image': entry(async ({ url, chat }) => {
      const img = await readImage(chat.cwd, url.searchParams.get('path') ?? '');
      return new Response(img.body, { headers: { 'content-type': img.type, 'cache-control': 'no-cache', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' } });
    }),
  };
}


export function chatMcpRoutes(d: RouteDeps): Record<string, Entry<ChatCtx>> {
  return {
    'ANY /api/mcp/config': entry(({ chat }) => mcpConfig(chat.cwd)),
    'POST /api/mcp/add': entry(async ({ url, chat }) => {
      const name = url.searchParams.get('name') ?? '';
      if (!(await configDef(chat.cwd, name))) return failed(404, `${name} is not in your MCP config`);
      return d.host.req({ op: 'mcp_add', id: chat.id, name });
    }),
    'POST /api/mcp/login': entry(async ({ url, chat }) => {
      const r = await d.host.req<{ authUrl?: string }>({ op: 'mcp_login', id: chat.id, name: url.searchParams.get('name') ?? '' });
      if (r.authUrl) openInChrome(r.authUrl);
      return r;
    }),
    'ANY /api/mcp/probe': entry(({ url, chat }) => provider(chat.provider ?? 'claude').mcpProbe(chat.cwd, url.searchParams.has('refresh'))),
    'POST /api/mcp/call': entry(async ({ body, chat }) => {
      const name = String(body.server ?? '');
      const def = await configDef(chat.cwd, name);
      if (!def) return failed(404, `${name} is not in your MCP config`);
      if (!(await inSettings(chat.cwd, name))) return failed(403, `${name} is not approved in Claude Code, so AgentView does not start it`);
      const r = await mcpCall(chat.cwd, name, def as McpServerDef, String(body.tool ?? ''), body.args ?? {});
      return { status: 'error' in r ? 400 : 200, body: r };
    }, true),
  };
}


export const chatPrefixes: Prefix<ChatCtx>[] = [
    { prefix: '/api/git/', run: ({ url, chat, body }) => gitRoute(chat.cwd, url.pathname.slice(9), url.searchParams, body), body: 'POST' },
    { prefix: '/api/gh/', run: ({ req, method, url, chat }) => github(chat.cwd, method, url, () => readBody(req)) },
    { prefix: '/api/deploy/', run: ({ req, method, url, chat }) => (deployUrl() ? deployRoute(chat.cwd, method, url, () => readBody(req)) : failed(404, 'Deploy is not set up')) },
];

