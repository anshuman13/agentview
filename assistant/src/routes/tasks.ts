import { isProfile } from '../db.js';
import { once } from '../once.js';
import { finishTask, snoozeTask } from '../remind.js';
import { parseTask } from '../parse.js';
import { summarizeSlack } from '../slack.js';
import { acceptAsk } from '../slackSave.js';
import { autopilotConfig, autopilotState, replyNow, saveAutopilot } from '../autopilot.js';
import { errText } from '../../../shared/util.js';
import { body, send, type Ctx, type Routes } from './http.js';

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

  'GET /autopilot': ({ res, getDb }) => send(res, 200, autopilotState(getDb())),
  'POST /autopilot': async (c) => {
    const data = await body<Record<string, unknown>>(c, 20_000);
    if (!data) return;
    const db = c.getDb();
    saveAutopilot(db, { ...autopilotConfig(db), ...data });
    send(c.res, 200, autopilotState(db));
  },

  'POST /slack/accept': accept('slack', 'Slack'),
  'POST /slack/reply': async ({ res, url, getDb }) => {
    const id = url.searchParams.get('id') ?? '';
    try {
      const r = await once(`reply:${id}`, () => replyNow(getDb(), autopilotConfig(getDb()), id));
      send(res, r ? 200 : 404, r ?? { error: 'No Slack ask with a draft' });
    } catch (err) {
      send(res, 502, { error: errText(err) });
    }
  },
  'POST /gmail/accept': accept('gmail', 'Gmail'),
};
