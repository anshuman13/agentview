import { BadRequest } from '../../../server/src/http/body.js';
import { currentVersion } from '../db.js';
import { applyChanges, pullChanges, type Change } from '../sync.js';
import { fail, readJson, send, type Routes } from './http.js';

export const syncRoutes: Routes = {
  'GET /health': ({ res, getDb }) => {
    const version = currentVersion(getDb());
    send(res, 200, { ok: true, version });
  },

  'POST /sync': async ({ req, res, device, getDb }) => {
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
  },

  'GET /changes': ({ res, url, device, getDb }) => {
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
  },
};
