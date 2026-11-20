import { isProfile } from '../core/db.js';
import { markUsed, searchWiki } from '../wiki/wikiSearch.js';
import { body, send, type Routes } from './http.js';

export const wikiRoutes: Routes = {
  'GET /wiki/search': ({ res, url, getDb }) => {
    const profile = url.searchParams.get('profile');
    if (!isProfile(profile)) {
      send(res, 400, { error: 'Missing or invalid profile' });
      return;
    }
    send(res, 200, searchWiki(getDb(), url.searchParams.get('q') ?? '', profile));
  },

  // Counts a use for each claim a chat was shown: POST /wiki/used with { profile, ids }.
  'POST /wiki/used': async (c) => {
    const data = await body<{ profile?: unknown; ids?: unknown }>(c, 100_000);
    if (!data) return;
    if (!isProfile(data.profile) || !Array.isArray(data.ids)) {
      send(c.res, 400, { error: 'Missing profile or ids' });
      return;
    }
    send(c.res, 200, { used: markUsed(c.getDb(), data.profile, data.ids.filter((id): id is string => typeof id === 'string')) });
  },
};
