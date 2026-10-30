import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allowedPeer, peerName } from '../../server/src/http/access.js';
import { BadRequest, parseObject, readBody } from '../../server/src/http/body.js';
import { openDb, currentVersion, isProfile, type Profile } from './db.js';
import { ACCOUNT_OF, lastAttempt, startCalendar, syncCalendar } from './calendar.js';
import { startJobs } from './jobs.js';
import { once } from './once.js';
import { finishTask, snoozeTask, startReminders } from './remind.js';
import { parseTask } from './parse.js';
import { startTranscripts, syncTranscript } from './transcripts.js';
import { acceptAsk, startSlack, summarizeSlack } from './slack.js';
import { startGmail } from './gmail.js';
import { applyChanges, pullChanges, SyncError, type Change } from './sync.js';

export const readJson = async (req: http.IncomingMessage, max: number) => parseObject(await readBody(req, max));

function send(res: http.ServerResponse, status: number, obj: unknown, headers: http.OutgoingHttpHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

function fail(res: http.ServerResponse, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'Request body too large') send(res, 413, { error: message }, { 'Connection': 'close' });
  else if (err instanceof BadRequest || err instanceof SyncError) send(res, 400, { error: message });
  else send(res, 500, { error: 'internal error' });
}

const isApp = (origin: string) => origin === 'http://tauri.localhost' || origin === 'tauri://localhost';

let db: ReturnType<typeof openDb> | null = null;

function getDb() {
  if (!db) {
    db = openDb();
  }
  return db;
}

// Only the phone app calls from a browser context; any other page (Origin or Sec-Fetch-Site set) could forge writes.
export function fromAllowedPage(h: http.IncomingHttpHeaders) {
  const origin = h.origin ?? '';
  if (isApp(origin)) return true;
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
      const app = isApp(origin);
      if (!fromAllowedPage(req.headers)) {
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
      const pathname = url.pathname;

      if (pathname === '/health' && req.method === 'GET') {
        const version = currentVersion(getDb());
        send(res, 200, { ok: true, version });
        return;
      }


      if (pathname === '/sync' && req.method === 'POST') {
        try {
          const data = (await readJson(req, 5_000_000)) as { since: number; changes: Change[] };
          if (!Number.isInteger(data.since) || data.since < 0) {
            throw new BadRequest('Missing or invalid since field');
          }
          if (!Array.isArray(data.changes)) {
            throw new BadRequest('Invalid changes field');
          }
          applyChanges(getDb(), data.changes);
          const pulled = pullChanges(getDb(), data.since);
          send(res, 200, {
            version: pulled.version,
            changes: pulled.changes,
            hasMore: pulled.hasMore,
            device,
          });
        } catch (err) {
          fail(res, err);
        }
        return;
      }

      if (pathname === '/calendar' && req.method === 'POST') {
        // The app asks with ?fresh=<ms> when it opens; a profile imported within that time is skipped.
        const fresh = Number(url.searchParams.get('fresh') ?? 0);
        const stale = (Object.keys(ACCOUNT_OF) as Profile[]).filter((p) => !fresh || Date.now() - lastAttempt(getDb(), p) > fresh);
        try {
          const { changed, errors } = stale.length ? await syncCalendar(getDb, stale) : { changed: 0, errors: [] };
          send(res, errors.length ? 502 : 200, errors.length ? { error: errors.join('; '), changed } : { changed });
        } catch (err) {
          send(res, 502, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (pathname === '/parse' && req.method === 'POST') {
        let data: { profile?: unknown; text?: unknown };
        try {
          data = await readJson(req, 20_000);
        } catch (err) {
          fail(res, err);
          return;
        }
        if (!isProfile(data.profile) || typeof data.text !== 'string' || !data.text.trim()) {
          send(res, 400, { error: 'Missing profile or text' });
          return;
        }
        try {
          const parsed = await parseTask(data.text.trim());
          send(res, 200, parsed);
        } catch (err) {
          send(res, 502, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (pathname === '/transcripts' && req.method === 'POST') {
        let data: { profile?: unknown; id?: unknown; instructions?: unknown };
        try {
          data = await readJson(req, 10_000);
        } catch (err) {
          fail(res, err);
          return;
        }
        if (!isProfile(data.profile) || typeof data.id !== 'string') {
          send(res, 400, { error: 'Missing profile or id' });
          return;
        }
        try {
          const saved = await syncTranscript(getDb(), data.profile, data.id, Date.now(), typeof data.instructions === 'string' ? data.instructions : '');
          send(res, 200, { saved });
        } catch (err) {
          send(res, 502, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (pathname === '/slack/summary' && req.method === 'POST') {
        try {
          const r = await once('slack', () => summarizeSlack(getDb()));
          send(res, 200, { added: r.added.length });
        } catch (err) {
          send(res, 502, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (pathname === '/slack/accept' && req.method === 'POST') {
        const ok = acceptAsk(getDb(), url.searchParams.get('id') ?? '');
        send(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such Slack task' });
        return;
      }

      if ((pathname === '/task/done' || pathname === '/task/snooze') && req.method === 'POST') {
        const act = pathname === '/task/done' ? finishTask : snoozeTask;
        const profile = url.searchParams.get('profile') ?? '';
        const ok = isProfile(profile) && act(getDb(), profile, url.searchParams.get('id') ?? '');
        send(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such task' });
        return;
      }

      if (pathname === '/gmail/accept' && req.method === 'POST') {
        const ok = acceptAsk(getDb(), url.searchParams.get('id') ?? '', 'gmail');
        send(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such Gmail task' });
        return;
      }

      if (pathname === '/changes' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? '0');
        if (!Number.isInteger(since) || since < 0) {
          send(res, 400, { error: 'Invalid since parameter' });
          return;
        }

        try {
          const pulled = pullChanges(getDb(), since);
          send(res, 200, {
            version: pulled.version,
            changes: pulled.changes,
            hasMore: pulled.hasMore,
            device,
          });
        } catch (err) {
          fail(res, err);
        }
        return;
      }

      send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (!res.headersSent) {
        send(res, 500, { error: 'internal error' });
      }
    }
  });

  return server;
}

async function start() {
  process.on('unhandledRejection', (err) => console.error('unhandled rejection:', err));
  const port = Number(process.env.ASSISTANT_PORT ?? 7790);
  const server = createServer();

  startReminders(getDb);
  if (process.env.ASSISTANT_CALENDAR !== '0') {
    startCalendar(getDb);
    startTranscripts(getDb);
    startJobs(getDb);
    startSlack(getDb);
    startGmail(getDb);
  }
  server.listen(port, '0.0.0.0', () => {
    console.log(`Assistant server listening on port ${port}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(console.error);
}
