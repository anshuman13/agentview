import { BadRequest } from '../../../server/src/http/body.js';
import { isProfile, type Profile } from '../db.js';
import { ACCOUNT_OF, lastAttempt, syncCalendar } from '../calendar.js';
import { addBlock } from '../block.js';
import { errText } from '../../../shared/util.js';
import { body, send, type Routes } from './http.js';

export const calendarRoutes: Routes = {
  'POST /calendar': async ({ res, url, getDb }) => {
    // The app asks with ?fresh=<ms> when it opens; a profile imported within that time is skipped.
    const fresh = Number(url.searchParams.get('fresh') ?? 0);
    if (!Number.isFinite(fresh) || fresh < 0) {
      send(res, 400, { error: 'fresh must be a number of milliseconds' });
      return;
    }
    const stale = (Object.keys(ACCOUNT_OF) as Profile[]).filter((p) => !fresh || Date.now() - lastAttempt(getDb(), p) > fresh);
    try {
      const { changed, errors } = stale.length ? await syncCalendar(getDb, stale) : { changed: 0, errors: [] };
      send(res, errors.length ? 502 : 200, errors.length ? { error: errors.join('; '), changed } : { changed });
    } catch (err) {
      send(res, 502, { error: errText(err) });
    }
  },

  'POST /calendar/block': async (c) => {
    const data = await body<{ profile?: unknown; id?: unknown; start?: unknown; end?: unknown; title?: unknown }>(c, 10_000);
    if (!data) return;
    const { profile, id, start, end, title } = data;
    if (!isProfile(profile) || typeof id !== 'string' || typeof start !== 'number' || typeof end !== 'number' || typeof title !== 'string') {
      send(c.res, 400, { error: 'Missing profile, id, start, end or title' });
      return;
    }
    try {
      send(c.res, 200, await addBlock(c.getDb, { profile, id, start, end, title }));
    } catch (err) {
      send(c.res, err instanceof BadRequest ? 400 : 502, { error: errText(err) });
    }
  },
};
