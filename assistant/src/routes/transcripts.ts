import { isProfile } from '../db.js';
import { NotFound, searchTranscripts, syncTranscript, transcriptText } from '../transcripts.js';
import { errText } from '../../../shared/util.js';
import { body, send, type Routes } from './http.js';

export const transcriptRoutes: Routes = {
  'POST /transcripts': async (c) => {
    const data = await body<{ profile?: unknown; id?: unknown; instructions?: unknown }>(c, 10_000);
    if (!data) return;
    if (!isProfile(data.profile) || typeof data.id !== 'string') {
      send(c.res, 400, { error: 'Missing profile or id' });
      return;
    }
    try {
      const saved = await syncTranscript(c.getDb(), data.profile, data.id, Date.now(), typeof data.instructions === 'string' ? data.instructions : '');
      send(c.res, 200, { saved });
    } catch (err) {
      send(c.res, err instanceof NotFound ? 404 : 502, { error: errText(err) });
    }
  },

  'GET /transcripts/search': ({ res, url, getDb }) => {
    const profile = url.searchParams.get('profile');
    send(res, 200, { hits: searchTranscripts(getDb(), url.searchParams.get('q') ?? '', isProfile(profile) ? profile : undefined) });
  },

  'GET /transcript': ({ res, url, getDb }) => {
    const profile = url.searchParams.get('profile');
    const text = isProfile(profile) ? transcriptText(getDb(), profile, url.searchParams.get('id') ?? '') : null;
    send(res, text == null ? 404 : 200, text == null ? { error: 'No transcript' } : { text });
  },
};
