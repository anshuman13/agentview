import { readFile } from 'node:fs/promises';
import { openInChrome } from '../chrome/chrome.js';
import { listSessions, renameRoute, savedSession } from '../agent/claude/sessions.js';
import { codexSessions } from '../agent/codex/threads.js';
import { isProvider, providerOptions } from '../agent/registry.js';
import { cancelFocus, scheduleFocus } from '../integrations/focus.js';
import { connectorStatus, mcpGroups, setMcpGroup } from '../agent/claude/mcp.js';
import { emptyBin, listBin, restoreSession } from '../agent/claude/bin.js';
import { pinsRoute, removeChat } from '../agent/claude/pins.js';
import { openRouterView, saveOpenRouter } from '../agent/claude/openrouter.js';
import { searchMessages } from '../agent/claude/search.js';
import { seenRoute } from '../agent/claude/seen.js';
import { advisorsMac, askAdvisorsMac, assistantRoute, expandHome, homeRelative } from '../integrations/assistant.js';
import { linkTitleRoute } from '../integrations/linkTitle.js';
import { otherMacs } from './macs.js';
import { hideableIds } from '../../../shared/featureUse.js';
import { clearFeatureUse, featureUseDays, recordRoute } from '../featureUse.js';
import { loadSettings, publicSettings, saveSettings } from '../settings.js';
import { listPorts, openPort } from './preview.js';
import { createFolder, createWorktree, listRepos, listWorktrees, removeWorktree } from '../workspace/worktrees.js';
import { branchSlug, makeWorktree } from '../workspace/tries.js';
import { readBody, savePaste } from './body.js';
import { entry, type Ctx, type Entry, type Prefix, type RouteDeps } from './routeTypes.js';
import { advisorsInfo, moveBacklogFile, readAudit, readBacklog } from '../session/advisors.js';
import { buildList } from '../session/builds.js';
import { allowedFolder, listSketches, readFileWithOriginal } from '../workspace/files.js';
import { exec } from '../exec.js';

// Advisors keep one copy of their files, on the hub Mac. Elsewhere that Mac answers their routes, with the project root
// sent relative to the home folder so it resolves there.
const rootParam = (url: URL) => expandHome(url.searchParams.get('root') ?? '');
const onHub = (fn: (c: Ctx) => unknown) => async (c: Ctx) => {
  if (!advisorsMac()) return fn(c);
  const q = new URLSearchParams(c.url.search);
  if (q.has('root')) q.set('root', homeRelative(q.get('root')!));
  return askAdvisorsMac(`${c.url.pathname}?${q}`, { method: c.method, body: c.method === 'POST' ? c.body : undefined });
};

const NOT_PROJECT = { status: 400, body: { error: 'Not a project folder' } };
// An advisor route on a project folder, answered by the hub Mac.
const inRoot = (fn: (root: string, c: Ctx) => unknown) => onHub((c) => {
  const root = rootParam(c.url);
  return allowedFolder(root) ? fn(root, c) : NOT_PROJECT;
});

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
    'GET /api/advisors': entry(onHub(() => advisorsInfo())),
    'GET /api/advisors/backlog': entry(inRoot((root) => readBacklog(root))),
    'GET /api/advisors/specs': entry(inRoot((root) => buildList(root))),
    'POST /api/advisors/backlog/move': entry(inRoot(async (root, { body }) => {
      if (body.dir !== 'up' && body.dir !== 'down') return { status: 400, body: { error: 'dir must be up or down' } };
      return (await moveBacklogFile(root, String(body.slug), body.dir)) ? readBacklog(root) : { status: 404, body: { error: 'Not in the backlog' } };
    }), true),
    'GET /api/advisors/audit': entry(inRoot((root) => readAudit(root))),
    'GET /api/advisors/sketches': entry(inRoot((root) => listSketches(root))),
    'GET /api/advisors/sketch': entry(inRoot((root, { url }) => {
      const name = url.searchParams.get('name') ?? '';
      return /^[^/]+\.html$/.test(name) ? readFileWithOriginal(root, `.claude/sketches/${name}`) : { status: 400, body: { error: 'Not a sketch' } };
    })),
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
      const [list, codex, bin] = await Promise.all([listSessions({ limit: 300 }), codexSessions(), listBin()]);
      const binned = new Set(bin.map((b) => b.sessionId));
      return [...list.filter((x) => !binned.has(x.sessionId)).map(savedSession), ...codex].sort((a, b) => b.lastModified - a.lastModified);
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
    'POST /api/jobs/start': entry(async ({ body }) => {
      const [jobId, title, repo, prompt] = ['jobId', 'title', 'repo', 'prompt'].map((k) => String(body[k] ?? ''));
      if (!jobId || !prompt.trim()) return { status: 400, body: { error: 'jobId and prompt are required' } };
      if (!(await listRepos()).some((r) => r.cwd === repo)) return { status: 400, body: { error: 'Not a workspace repo' } };
      if (d.runs().some((r) => r.kind === 'job' && r.jobId === jobId && r.state !== 'done')) return { status: 409, body: { error: 'The last run is still open' } };
      const branch = `jobs/${branchSlug(title)}`;
      const { dir, paseo } = await makeWorktree(repo, branch);
      return { chatId: await d.host.req<string>({ op: 'job', cwd: dir, title, prompt, jobId, branch, repo, paseo }), branch };
    }, true),
    'POST /api/paste': entry(async ({ req, url }) => ({ path: await savePaste(req, url.searchParams.get('name') ?? '') })),
    'POST /api/folders': entry(async ({ body }) => ({ cwd: await createFolder(String(body.root ?? ''), String(body.name ?? '').trim()) }), true),
    'POST /api/open': entry(({ body }) => {
      const target = String(body.url ?? '');
      if (!/^https?:\/\//.test(target)) return { status: 400, body: { error: 'Only http(s) links open' } };
      if (body.browser === 'firefox' && process.platform === 'darwin') exec('open', ['-a', 'Firefox', target]).catch((err) => console.error('open in firefox:', err.message));
      else openInChrome(target);
      return { ok: true };
    }, true),
    'ANY /api/worktrees': entry(() => listWorktrees(liveCwds())),
    'ANY /api/repos': entry(() => listRepos()),
    'ANY /api/ports': entry(() => listPorts()),
    'ANY /api/ports/open': entry(({ req, url }) => openPort(Number(url.searchParams.get('port')), req.headers.get('host') ?? undefined)),
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
    'POST /api/settings': entry(async ({ body }) => {
      const { defaultProvider, featureUse, hiddenFeatures } = body;
      if (defaultProvider === undefined && featureUse === undefined && hiddenFeatures === undefined) return { status: 400, body: { error: 'defaultProvider, featureUse or hiddenFeatures is required' } };
      if (defaultProvider !== undefined && !isProvider(defaultProvider)) return { status: 400, body: { error: 'defaultProvider is not a provider' } };
      if (featureUse !== undefined && typeof featureUse !== 'boolean') return { status: 400, body: { error: 'featureUse is not a boolean' } };
      if (hiddenFeatures !== undefined && !(Array.isArray(hiddenFeatures) && hiddenFeatures.every((id) => typeof id === 'string'))) return { status: 400, body: { error: 'hiddenFeatures is not a list of strings' } };
      await saveSettings({ ...loadSettings(), ...(defaultProvider !== undefined && { defaultProvider }), ...(featureUse !== undefined && { featureUse }), ...(hiddenFeatures !== undefined && { hiddenFeatures: hideableIds(hiddenFeatures) }) });
      if (featureUse === false) await clearFeatureUse();
      return { ...publicSettings(), providers: await providerOptions() };
    }, true),
    'POST /api/feature-use': entry(({ body }) => recordRoute(body.id), true),
    'ANY /api/feature-use': entry(async () => ({ on: loadSettings().featureUse, days: await featureUseDays() })),
    'ANY /api/settings': entry(async () => ({ ...publicSettings(), providers: await providerOptions() })),
    'POST /api/openrouter': entry(({ body }) => saveOpenRouter(body), true),
    'ANY /api/openrouter': entry(() => openRouterView()),
    'POST /api/restart': entry(({ url }) => {
      d.restart(url.searchParams.has('now'), url.searchParams.has('full'));
      return { ok: true };
    }),
    'ANY /api/app.apk': entry(async () => new Response(await readFile(d.APK), { headers: { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename="AgentView.apk"' } })),
    'ANY /api/connect': entry(async ({ req, ip, url }) => {
      const port = [url.searchParams.get('port'), req.headers.get('host')?.match(/:(\d+)$/)?.[1]].find((p) => p && /^\d{1,5}$/.test(p)) ?? String(d.PORT);
      const ips = Object.values(d.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal && d.allowedPeer(a.address))
        .map((a) => a!.address);
      const running = [...d.chats().values()].filter((c) => c.running).length;
      const { macs, problem } = url.searchParams.has('peer') ? { macs: [] } : await otherMacs(port, ip);
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

