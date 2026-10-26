import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allowedPeer, peerName } from '../../server/src/http/access.js';
import { readBody } from '../../server/src/http/body.js';
import { openDb, currentVersion } from './db.js';
import { PROFILES, lastImport, startCalendar, syncCalendar, type Profile } from './calendar.js';
import { startReminders } from './remind.js';
import { startTranscripts, syncTranscript } from './transcripts.js';
import { applyChanges, pullChanges, SyncError, type Change } from './sync.js';

class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

let db: ReturnType<typeof openDb> | null = null;

function getDb() {
  if (!db) {
    db = openDb();
  }
  return db;
}

export function createServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const addr = req.socket.remoteAddress ?? '';
      const device = allowedPeer(addr) ? peerName(addr) : undefined;
      if (!device) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end('{"error":"Forbidden"}');
        return;
      }

      const origin = req.headers.origin ?? '';
      if (origin === 'http://tauri.localhost' || origin === 'tauri://localhost') {
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, version }));
        return;
      }


      if (pathname === '/sync' && req.method === 'POST') {
        try {
          const body = await readBody(req, 5_000_000);
          let data: { since: number; changes: Change[] };
          try {
            data = JSON.parse(body);
          } catch {
            throw new BadRequest('Invalid JSON');
          }
          if (!data || !Number.isInteger(data.since) || data.since < 0) {
            throw new BadRequest('Missing or invalid since field');
          }
          if (!Array.isArray(data.changes)) {
            throw new BadRequest('Invalid changes field');
          }
          const applied = applyChanges(getDb(), data.changes ?? []);
          const pulled = pullChanges(getDb(), data.since);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            version: pulled.version,
            changes: pulled.changes,
            hasMore: pulled.hasMore,
            device,
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === 'Request body too large') {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
            res.end(JSON.stringify({ error: 'Request body too large' }));
          } else if (err instanceof BadRequest || err instanceof SyncError) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal error' }));
          }
        }
        return;
      }

      if (pathname === '/calendar' && req.method === 'POST') {
        // The app asks with ?fresh=<ms> when it opens; a profile imported within that time is skipped.
        const fresh = Number(url.searchParams.get('fresh') ?? 0);
        const stale = (Object.keys(PROFILES) as Profile[]).filter((p) => !fresh || Date.now() - lastImport(getDb(), p) > fresh);
        try {
          const { changed, errors } = stale.length ? await syncCalendar(getDb, stale) : { changed: 0, errors: [] };
          res.writeHead(errors.length ? 502 : 200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(errors.length ? { error: errors.join('; '), changed } : { changed }));
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      if (pathname === '/transcripts' && req.method === 'POST') {
        let data: { profile?: unknown; id?: unknown };
        try {
          data = JSON.parse(await readBody(req, 10_000));
        } catch {
          data = {};
        }
        if ((data.profile !== 'work' && data.profile !== 'personal') || typeof data.id !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"Missing profile or id"}');
          return;
        }
        try {
          const saved = await syncTranscript(getDb(), data.profile, data.id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ saved }));
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      if (pathname === '/changes' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? '0');
        if (!Number.isInteger(since) || since < 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"Invalid since parameter"}');
          return;
        }

        try {
          const pulled = pullChanges(getDb(), since);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            version: pulled.version,
            changes: pulled.changes,
            hasMore: pulled.hasMore,
            device,
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof BadRequest || err instanceof SyncError) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal error' }));
          }
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"Not found"}');
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      }
    }
  });

  return server;
}

async function start() {
  const port = Number(process.env.ASSISTANT_PORT ?? 7790);
  const server = createServer();

  startReminders(getDb);
  if (process.env.ASSISTANT_CALENDAR !== '0') {
    startCalendar(getDb);
    startTranscripts(getDb);
  }
  server.listen(port, '0.0.0.0', () => {
    console.log(`Assistant server listening on port ${port}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(console.error);
}
