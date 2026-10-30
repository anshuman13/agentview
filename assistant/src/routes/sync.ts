import { BadRequest } from '../../../server/src/http/body.js';
import { pausedScans } from '../claude.js';
import { currentVersion } from '../db.js';
import { scanHealth } from '../scan.js';
import { SCANNERS } from './scan.js';
import { exchange, type Change } from '../sync.js';
import { fail, readJson, send, type Ctx, type Routes } from './http.js';

function sendPulled({ res, device, getDb }: Ctx, since: number, changes: Change[] = []) {
  const pulled = exchange(getDb(), since, changes);
  send(res, 200, { version: pulled.version, changes: pulled.changes, hasMore: pulled.hasMore, device, paused: pausedScans(getDb()), scans: scanHealth(getDb(), Object.keys(SCANNERS).filter((n) => !SCANNERS[n].setUp())) });
}

export const syncRoutes: Routes = {
  'GET /health': ({ res, getDb }) => {
    const version = currentVersion(getDb());
    send(res, 200, { ok: true, version });
  },

  'POST /sync': async (c) => {
    try {
      const data = (await readJson(c.req, 5_000_000)) as { since: number; changes: Change[] };
      if (!Number.isInteger(data.since) || data.since < 0) {
        throw new BadRequest('Missing or invalid since field');
      }
      if (!Array.isArray(data.changes)) {
        throw new BadRequest('Invalid changes field');
      }
      sendPulled(c, data.since, data.changes);
    } catch (err) {
      fail(c.res, err);
    }
  },

  'GET /changes': (c) => {
    const since = Number(c.url.searchParams.get('since') ?? '0');
    if (!Number.isInteger(since) || since < 0) {
      send(c.res, 400, { error: 'Invalid since parameter' });
      return;
    }
    try {
      sendPulled(c, since);
    } catch (err) {
      fail(c.res, err);
    }
  },
};
