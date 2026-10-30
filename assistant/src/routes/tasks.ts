import { isProfile } from '../db.js';
import { once } from '../once.js';
import { finishTask, snoozeTask } from '../remind.js';
import { parseTask } from '../parse.js';
import { summarizeSlack } from '../slack.js';
import { acceptAsk } from '../slackSave.js';
import { body, errText, send, type Ctx, type Routes } from './http.js';

function taskAction(act: typeof finishTask) {
  return ({ res, url, getDb }: Ctx) => {
    const profile = url.searchParams.get('profile') ?? '';
    const ok = isProfile(profile) && act(getDb(), profile, url.searchParams.get('id') ?? '');
    send(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such task' });
  };
}

function accept(source: 'slack' | 'gmail', name: string) {
  return ({ res, url, getDb }: Ctx) => {
    const ok = acceptAsk(getDb(), url.searchParams.get('id') ?? '', source);
    send(res, ok ? 200 : 404, ok ? { ok } : { error: `No such ${name} task` });
  };
}

export const taskRoutes: Routes = {
  'POST /parse': async (c) => {
    const data = await body<{ profile?: unknown; text?: unknown }>(c, 20_000);
    if (!data) return;
    if (!isProfile(data.profile) || typeof data.text !== 'string' || !data.text.trim()) {
      send(c.res, 400, { error: 'Missing profile or text' });
      return;
    }
    try {
      send(c.res, 200, await parseTask(data.text.trim()));
    } catch (err) {
      send(c.res, 502, { error: errText(err) });
    }
  },

  'POST /task/done': taskAction(finishTask),
  'POST /task/snooze': taskAction(snoozeTask),

  'POST /slack/summary': async ({ res, getDb }) => {
    try {
      const r = await once('slack', () => summarizeSlack(getDb()));
      send(res, 200, { added: r.added.length });
    } catch (err) {
      send(res, 502, { error: errText(err) });
    }
  },

  'POST /slack/accept': accept('slack', 'Slack'),
  'POST /gmail/accept': accept('gmail', 'Gmail'),
};
