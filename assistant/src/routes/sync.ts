import { BadRequest } from '../../../server/src/json.js';
import { pausedScans } from '../core/claude.js';
import { currentVersion } from '../core/db.js';
import { scanHealth } from '../core/scan.js';
import { SCANNERS } from './scan.js';
import { exchange, type Change } from '../core/sync.js';
import { fail, readJson, send, type Ctx, type Routes } from './http.js';

const SETUP_TTL = 60_000;
let unconfigured: { names: string[]; at: number } | null = null;

export function resetScannerCache() {
  unconfigured = null;
}

export function unconfiguredScanners(now = Date.now(), scanners = SCANNERS) {
  if (!unconfigured || now - unconfigured.at >= SETUP_TTL) {
    unconfigured = { names: Object.keys(scanners).filter((n) => !scanners[n].setUp()), at: now };
  }
  return unconfigured.names;
}

function sendPulled({ res, device, getDb }: Ctx, since: number, changes: Change[] = [], full = false) {
  const pulled = exchange(getDb(), since, changes);
  const idle = pulled.version === since && changes.length === 0 && !full;
  const health = idle ? {} : { paused: pausedScans(getDb()), scans: scanHealth(getDb(), unconfiguredScanners()) };
  send(res, 200, { version: pulled.version, changes: pulled.changes, hasMore: pulled.hasMore, rejected: pulled.rejected, device, ...health });
}

export const syncRoutes: Routes = {
  'GET /health': ({ res, getDb }) => {
    const version = currentVersion(getDb());
    send(res, 200, { ok: true, version });
  },

  'GET /debug': ({ res }) => send(res, 200, { debug: process.env.ASSISTANT_DEBUG === '1' }),

  'POST /sync': async (c) => {
    try {
      const data = (await readJson(c.req, 5_000_000)) as { since: number; changes: Change[]; full?: unknown };
      if (!Number.isInteger(data.since) || data.since < 0) {
        throw new BadRequest('Missing or invalid since field');
      }
      if (!Array.isArray(data.changes)) {
        throw new BadRequest('Invalid changes field');
      }
      sendPulled(c, data.since, data.changes, data.full === true);
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
      sendPulled(c, since, [], c.url.searchParams.get('full') === '1');
    } catch (err) {
      fail(c.res, err);
    }
  },
};
