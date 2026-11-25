import { readFile } from 'node:fs/promises';
import { openInChrome } from '../chrome/chrome.js';
import { listSessions, renameRoute, savedSession } from '../agent/claude/sessions.js';
import { loggedInAccounts } from '../agent/claude/accounts.js';
import { codexSessions } from '../agent/codex/threads.js';
import { isProvider, providerOptions } from '../agent/registry.js';
import { cancelFocus, scheduleFocus } from '../integrations/focus.js';
import { connectorStatus, mcpGroups, setMcpGroup } from '../agent/claude/mcp.js';
import { emptyBin, listBin, restoreSession } from '../agent/claude/bin.js';
import { pinsRoute, removeChat } from '../agent/claude/pins.js';
import { openRouterView, saveOpenRouter } from '../agent/claude/openrouter.js';
import { resolvedRoute } from '../agent/claude/resolved.js';
import { searchMessages } from '../agent/claude/search.js';
import { seenRoute } from '../agent/claude/seen.js';
import { listLinks } from '../session/subChats.js';
import { readSummaries } from '../agent/claude/summaryStore.js';
import { assistantRoute } from '../integrations/assistant.js';
import { linkTitleRoute } from '../integrations/linkTitle.js';
import { otherMacs } from './macs.js';
import { hideableIds } from '../../../shared/featureUse.js';
import { ACCOUNT_LABEL, type Account, type SavedSession } from '../../../shared/protocol.js';
import { clearFeatureUse, featureUseDays, recordRoute } from '../featureUse.js';
import { loadSettings, publicSettings, saveSettings } from '../settings.js';
import { listPorts, openPort } from './preview.js';
import { createFolder, createWorktree, isWorkspaceRepo, listRepos, listWorktrees, removeRunWorktree, removeWorktree } from '../workspace/worktrees.js';
import { branchSlug, makeWorktree } from '../workspace/tries.js';
import { savePaste } from './body.js';
import { readBody, failed } from '../json.js';
import { entry, type Ctx, type Entry, type Prefix, type RouteDeps } from './routeTypes.js';
import { exec } from '../exec.js';

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
    'ANY /api/questions/resolved': entry(({ method, url }) => resolvedRoute(method, url.searchParams.get('key'))),
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
      const [list, codex, bin, summaries, links] = await Promise.all([listSessions({ limit: 1000 }), codexSessions(), listBin(), readSummaries(), listLinks()]);
      const binned = new Set(bin.map((b) => b.sessionId));
      const linked = (s: SavedSession): SavedSession => {
        const l = links[s.sessionId];
        return l ? { ...s, parentId: l.parent, via: l.via, startedAt: l.at } : s;
      };
      return [...list.filter((x) => !binned.has(x.sessionId)).map((x) => linked(savedSession(x, summaries[x.sessionId]?.text))), ...codex].sort((a, b) => b.lastModified - a.lastModified);
    }),
    'ANY /api/sessions/search': entry(async ({ url }) => {
      const [hits, list, bin, links] = await Promise.all([searchMessages(url.searchParams.get('q') ?? ''), listSessions({ limit: 1000 }), listBin(), listLinks()]);
      const binned = new Set(bin.map((b) => b.sessionId));
      const byId = new Map(list.map((x) => [x.sessionId, x]));
      return hits
        .filter((h) => byId.has(h.sessionId) && !binned.has(h.sessionId))
        .map((h) => ({ ...h, title: byId.get(h.sessionId)!.summary, cwd: byId.get(h.sessionId)!.cwd ?? '', ...(links[h.sessionId] && { parentId: links[h.sessionId].parent }) }));
    }),
  };
}


export function workspaceRoutes(d: RouteDeps): Record<string, Entry<Ctx>> {
  // Open chats and open job runs, whose worktree a review still needs, are in use.
  // Jobs whose worktree is being made, so a second start in that time is refused.
  const starting = new Set<string>();
  const liveCwds = () => [...[...d.chats().values()].map((c) => c.cwd), ...d.runs().flatMap((r) => (r.kind === 'job' && r.state !== 'done' && r.worktree ? [r.worktree] : []))];

  return {
    'DELETE /api/worktrees': entry(async ({ url }) => {
      await removeWorktree(url.searchParams.get('id') ?? '', liveCwds());
      return { ok: true };
    }),
    'POST /api/worktrees': entry(async ({ body }) => ({ cwd: await createWorktree(String(body.repo ?? ''), String(body.branch ?? '').trim()) }), true),
    'POST /api/jobs/start': entry(async ({ req, body }) => {
      const [jobId, title, repo, prompt] = ['jobId', 'title', 'repo', 'prompt'].map((k) => String(body[k] ?? ''));
      if (!jobId || !prompt.trim()) return failed(400, 'jobId and prompt are required');
      const account = body.account == null ? undefined : String(body.account);
      if (account !== undefined && !Object.hasOwn(ACCOUNT_LABEL, account)) return failed(400, 'Unknown account');
      if (account !== undefined && !loggedInAccounts().includes(account as Account)) return failed(400, 'Account not logged in');
      if (!isWorkspaceRepo(repo)) return failed(400, 'Not a workspace repo');
      if (d.runs().some((r) => r.kind === 'job' && r.jobId === jobId && r.state !== 'done')) return failed(409, 'The last run is still open');
      const branch = `jobs/${branchSlug(title)}`;
      if (starting.has(jobId)) return failed(409, 'The job is starting');
      starting.add(jobId);
      try {
        const { dir, paseo } = await makeWorktree(repo, branch);
        // No chat took the worktree, so it goes. The hub gives up after 2 minutes and records the run as failed.
        const drop = () => removeRunWorktree({ repo, worktree: dir, branch, paseo }).catch(() => {});
        if (req.signal.aborted) {
          await drop();
          return failed(499, 'The caller gave up');
        }
        const chatId = await d.host.req<string>({ op: 'job', cwd: dir, title, prompt, jobId, branch, repo, paseo, ...(account && { account: account as Account }) }).catch(async (err) => {
          await drop();
          throw err;
        });
        return { chatId, branch };
      } finally {
        starting.delete(jobId);
      }
    }, true),
    'POST /api/paste': entry(async ({ req, url }) => ({ path: await savePaste(req, url.searchParams.get('name') ?? '') })),
    'POST /api/folders': entry(async ({ body }) => ({ cwd: await createFolder(String(body.root ?? ''), String(body.name ?? '').trim()) }), true),
    'POST /api/open': entry(({ body }) => {
      const target = String(body.url ?? '');
      if (!/^https?:\/\//.test(target)) return failed(400, 'Only http(s) links open');
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
      if (!service) return failed(400, 'service is required');
      return setMcpGroup(service, String(body.group ?? ''));
    }, true),
    'ANY /api/mcp/groups': entry(() => mcpGroups()),
    'POST /api/settings': entry(async ({ body }) => {
      const { defaultProvider, featureUse, hiddenFeatures } = body;
      if (defaultProvider === undefined && featureUse === undefined && hiddenFeatures === undefined) return failed(400, 'defaultProvider, featureUse or hiddenFeatures is required');
      if (defaultProvider !== undefined && !isProvider(defaultProvider)) return failed(400, 'defaultProvider is not a provider');
      if (featureUse !== undefined && typeof featureUse !== 'boolean') return failed(400, 'featureUse is not a boolean');
      if (hiddenFeatures !== undefined && !(Array.isArray(hiddenFeatures) && hiddenFeatures.every((id) => typeof id === 'string'))) return failed(400, 'hiddenFeatures is not a list of strings');
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

