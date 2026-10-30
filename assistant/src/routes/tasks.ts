import { isProfile } from '../db.js';
import { once } from '../once.js';
import { finishTask, snoozeTask } from '../remind.js';
import { parseTask } from '../parse.js';
import { acceptAsk, summarizeSlack } from '../slack.js';
import { fail, readJson, send, type Ctx, type Routes } from './http.js';

function taskAction(act: typeof finishTask) {
  return ({ res, url, getDb }: Ctx) => {
    const profile = url.searchParams.get('profile') ?? '';
    const ok = isProfile(profile) && act(getDb(), profile, url.searchParams.get('id') ?? '');
    send(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such task' });
  };
}

export const taskRoutes: Routes = {
  'POST /parse': async ({ req, res }) => {
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
  },

  'POST /task/done': taskAction(finishTask),
  'POST /task/snooze': taskAction(snoozeTask),

  'POST /slack/summary': async ({ res, getDb }) => {
    try {
      const r = await once('slack', () => summarizeSlack(getDb()));
      send(res, 200, { added: r.added.length });
    } catch (err) {
      send(res, 502, { error: err instanceof Error ? err.message : String(err) });
    }
  },

  'POST /slack/accept': ({ res, url, getDb }) => {
    const ok = acceptAsk(getDb(), url.searchParams.get('id') ?? '');
    send(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such Slack task' });
  },

  'POST /gmail/accept': ({ res, url, getDb }) => {
    const ok = acceptAsk(getDb(), url.searchParams.get('id') ?? '', 'gmail');
    send(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such Gmail task' });
  },
};
