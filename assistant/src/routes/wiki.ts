import { isProfile } from '../db.js';
import { searchWiki } from '../wikiSearch.js';
import { send, type Routes } from './http.js';

export const wikiRoutes: Routes = {
  'GET /wiki/search': ({ res, url, getDb }) => {
    const profile = url.searchParams.get('profile');
    if (!isProfile(profile)) {
      send(res, 400, { error: 'Missing or invalid profile' });
      return;
    }
    send(res, 200, searchWiki(getDb(), url.searchParams.get('q') ?? '', profile));
  },
};
