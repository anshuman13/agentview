import { pathToFileURL } from 'node:url';
import { APP_ORIGINS, allowedHostHeader, allowedPeer, peerName } from '../../server/src/http/access.js';
import { openDb } from './core/db.js';
import { trackSpend } from './core/claude.js';
import { startCommands } from './slack/commands.js';
import { ACCOUNT_OF, startCalendar } from './calendar/calendar.js';
import { startJobs } from './jobs/jobs.js';
import { startReminders } from './jobs/remind.js';
import { startBrief } from './jobs/brief.js';
import { startTranscripts } from './meetings/transcripts.js';
import { HUB_URL, slackScan, startSlack } from './slack/slack.js';
import { gmailScan, startGmail } from './calendar/gmail.js';
import { startStallWatch } from './core/scan.js';
import { hm } from './core/time.js';
import { Reply, type Routes } from './routes/http.js';
import { syncRoutes } from './routes/sync.js';
import { calendarRoutes } from './routes/calendar.js';
import { transcriptRoutes } from './routes/transcripts.js';
import { wikiRoutes } from './routes/wiki.js';
import { taskRoutes } from './routes/tasks.js';
import { scanRoutes } from './routes/scan.js';

const routes: Routes = { ...syncRoutes, ...calendarRoutes, ...transcriptRoutes, ...wikiRoutes,...taskRoutes, ...scanRoutes() };

const ownHost = (host = '') => allowedHostHeader(host) || host === new URL(HUB_URL).host;

let db: ReturnType<typeof openDb> | null = null;

const getDb = () => (db ??= trackSpend(openDb()));

// Only the phone app calls from a browser context; any other page (Origin or Sec-Fetch-Site set) could forge writes.
export function fromAllowedPage(h: { origin?: string; 'sec-fetch-site'?: string }) {
  const origin = h.origin ?? '';
  if (APP_ORIGINS.has(origin)) return true;
  const site = h['sec-fetch-site'];
  return !origin && (!site || site === 'none' || site === 'same-origin');
}

async function handle(req: Request, server: Bun.Server<undefined>): Promise<Response> {
  const addr = server.requestIP(req)?.address ?? '';
  const device = allowedPeer(addr) ? peerName(addr) : undefined;
  const headers = Object.fromEntries(req.headers);
  if (!device || !ownHost(headers.host) || !fromAllowedPage(headers)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const origin = headers.origin ?? '';
  const res = new Reply(APP_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST', Vary: 'Origin' } : {});
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: res.headers });
  const url = new URL(req.url);
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) res.send(404, { error: 'Not found' });
  else {
    void Promise.resolve()
      .then(() => route({ req, res, url, device, getDb }))
      .catch((err) => {
        console.error(`${req.method} ${url.pathname}:`, err);
        res.send(500, { error: 'internal error' });
      })
      .finally(() => res.send(500, { error: 'The route sent no answer' }));
  }
  return res.response;
}

export function serve(port: number, hostname = '0.0.0.0') {
  return Bun.serve({ port, hostname, idleTimeout: 255, fetch: handle });
}

// api.log has no timestamps of its own, so each hub log line starts with HH:MM.
function stampConsole() {
  for (const k of ['log', 'error'] as const) {
    const write = console[k].bind(console);
    console[k] = (...args: unknown[]) => write(hm(Date.now()), ...args);
  }
}

async function start() {
  stampConsole();
  process.on('unhandledRejection', (err) => console.error('unhandled rejection:', err));
  const port = Number(process.env.ASSISTANT_PORT ?? 7790);

  startReminders(getDb);
  startBrief(getDb);
  if (process.env.ASSISTANT_CALENDAR !== '0') {
    startCalendar(getDb);
    startTranscripts(getDb);
    startJobs(getDb);
    startSlack(getDb);
    startCommands(getDb);
    startGmail(getDb);
    startStallWatch(getDb, { slack: slackScan.setUp, gmail: gmailScan.setUp, ...Object.fromEntries(Object.keys(ACCOUNT_OF).map((p) => [`calendar:${p}`, () => true])) });
  }
  serve(port);
  console.log(`Assistant server listening on port ${port}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(console.error);
}
