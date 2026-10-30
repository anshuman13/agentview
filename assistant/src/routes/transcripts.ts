import { isProfile } from '../db.js';
import { NotFound, searchTranscripts, syncTranscript, transcriptText } from '../transcripts.js';
import { fail, readJson, send, type Routes } from './http.js';

export const transcriptRoutes: Routes = {
  'POST /transcripts': async ({ req, res, getDb }) => {
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
      send(res, err instanceof NotFound ? 404 : 502, { error: err instanceof Error ? err.message : String(err) });
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
