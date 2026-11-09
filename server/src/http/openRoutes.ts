import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { openInChrome } from '../chrome/chrome.js';
import { listSessions, renameRoute, savedSession } from '../agent/claude/sessions.js';
import { cancelFocus, scheduleFocus } from '../integrations/focus.js';
import { connectorStatus, mcpGroups, setMcpGroup } from '../agent/claude/mcp.js';
import { emptyBin, listBin, restoreSession } from '../agent/claude/bin.js';
import { pinsRoute, removeChat } from '../agent/claude/pins.js';
import { searchMessages } from '../agent/claude/search.js';
import { seenRoute } from '../agent/claude/seen.js';
import { assistantRoute } from '../integrations/assistant.js';
import { linkTitleRoute } from '../integrations/linkTitle.js';
import { otherMacs } from './macs.js';
import { listPorts, openPort } from './preview.js';
import { createFolder, createWorktree, listRepos, listWorktrees, removeWorktree } from '../workspace/worktrees.js';
import { readBody, savePaste } from './body.js';
import { HANDLED, entry, type Ctx, type Entry, type Prefix, type RouteDeps } from './routeTypes.js';

export function sessionRoutes(d: RouteDeps): Record<string, Entry<Ctx>> {
  return {
    'ANY /api/runs': entry(() => d.runs()),
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
    'ANY /api/sessions/seen': entry(({ method, url }) => seenRoute(method, url.searchParams.get('id'), url.searchParams.get('unread') === '1')),
    'DELETE /api/sessions/bin': entry(async () => {
      await emptyBin();
      return { ok: true };
    }),
    'ANY /api/sessions/bin': entry(() => listBin()),
    'POST /api/sessions/restore': entry(async ({ url }) => {
      await restoreSession(url.searchParams.get('id') ?? '');
      return { ok: true };
    }),
    'ANY /api/sessions': entry(async () => {
      const [list, bin] = await Promise.all([listSessions({ limit: 300 }), listBin()]);
      const binned = new Set(bin.map((b) => b.sessionId));
      return list.filter((x) => !binned.has(x.sessionId)).map(savedSession);
    }),
    'ANY /api/sessions/search': entry(async ({ url }) => {
      const [hits, list, bin] = await Promise.all([searchMessages(url.searchParams.get('q') ?? ''), listSessions({ limit: 300 }), listBin()]);
      const binned = new Set(bin.map((b) => b.sessionId));
      const byId = new Map(list.map((x) => [x.sessionId, x]));
      return hits.filter((h) => byId.has(h.sessionId) && !binned.has(h.sessionId)).map((h) => ({ ...h, title: byId.get(h.sessionId)!.summary, cwd: byId.get(h.sessionId)!.cwd ?? '' }));
    }),
  };
}


export function workspaceRoutes(d: RouteDeps): Record<string, Entry<Ctx>> {
  const liveCwds = () => [...d.chats().values()].map((c) => c.cwd);

  return {
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
    'ANY /api/worktrees': entry(() => listWorktrees(liveCwds())),
    'ANY /api/repos': entry(() => listRepos()),
    'ANY /api/ports': entry(() => listPorts()),
    'ANY /api/ports/open': entry(({ req, url }) => openPort(Number(url.searchParams.get('port')), req.headers.host)),
  };
}


export function systemRoutes(d: RouteDeps): Record<string, Entry<Ctx>> {
  return {
    'ANY /api/link-title': entry(({ url }) => linkTitleRoute(url)),
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
    'POST /api/focus': entry(({ body }) => {
      const r = scheduleFocus(body?.title, body?.end);
      return 'error' in r ? { status: 400, body: r } : r;
    }, true),
    'DELETE /api/focus': entry(() => {
      cancelFocus();
      return { ok: true };
    }),
  };
}


export const openPrefixes: Prefix<Ctx>[] = [
    { prefix: '/api/assistant/', run: ({ method, url, req }) => assistantRoute(method, url, () => readBody(req, 5_000_000)) },
];

