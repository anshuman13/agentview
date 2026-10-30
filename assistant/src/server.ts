import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { APP_ORIGINS, allowedHostHeader, allowedPeer, peerName } from '../../server/src/http/access.js';
import { openDb } from './db.js';
import { ACCOUNT_OF, startCalendar } from './calendar.js';
import { startJobs } from './jobs.js';
import { startReminders } from './remind.js';
import { startBrief } from './brief.js';
import { startTranscripts } from './transcripts.js';
import { HUB_URL, slackScan, startSlack } from './slack.js';
import { gmailScan, startGmail } from './gmail.js';
import { startStallWatch } from './scan.js';
import { hm } from './time.js';
import { send, type Routes } from './routes/http.js';
import { syncRoutes } from './routes/sync.js';
import { calendarRoutes } from './routes/calendar.js';
import { transcriptRoutes } from './routes/transcripts.js';
import { taskRoutes } from './routes/tasks.js';
import { scanRoutes } from './routes/scan.js';

const routes: Routes = { ...syncRoutes, ...calendarRoutes, ...transcriptRoutes, ...taskRoutes, ...scanRoutes() };

const ownHost = (host = '') => allowedHostHeader(host) || host === new URL(HUB_URL).host;

let db: ReturnType<typeof openDb> | null = null;

const getDb = () => (db ??= openDb());

// Only the phone app calls from a browser context; any other page (Origin or Sec-Fetch-Site set) could forge writes.
export function fromAllowedPage(h: http.IncomingHttpHeaders) {
  const origin = h.origin ?? '';
  if (APP_ORIGINS.has(origin)) return true;
  const site = h['sec-fetch-site'];
  return !origin && (!site || site === 'none' || site === 'same-origin');
}

export function createServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const addr = req.socket.remoteAddress ?? '';
      const device = allowedPeer(addr) ? peerName(addr) : undefined;
      if (!device) {
        send(res, 403, { error: 'Forbidden' });
        return;
      }

      const origin = req.headers.origin ?? '';
      const app = APP_ORIGINS.has(origin);
      if (!ownHost(req.headers.host) || !fromAllowedPage(req.headers)) {
        send(res, 403, { error: 'Forbidden' });
        return;
      }
      if (app) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = routes[`${req.method} ${url.pathname}`];
      if (route) {
        await route({ req, res, url, device, getDb });
        return;
      }

      send(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error(`${req.method} ${req.url?.split('?')[0]}:`, err);
      if (!res.headersSent) {
        send(res, 500, { error: 'internal error' });
      }
    }
  });

  return server;
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
  const server = createServer();

  startReminders(getDb);
  startBrief(getDb);
  if (process.env.ASSISTANT_CALENDAR !== '0') {
    startCalendar(getDb);
    startTranscripts(getDb);
    startJobs(getDb);
    startSlack(getDb);
    startGmail(getDb);
    startStallWatch(getDb, { slack: slackScan.setUp, gmail: gmailScan.setUp, ...Object.fromEntries(Object.keys(ACCOUNT_OF).map((p) => [`calendar:${p}`, () => true])) });
  }
  server.listen(port, '0.0.0.0', () => {
    console.log(`Assistant server listening on port ${port}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(console.error);
}
