import { isProfile } from '../db.js';
import { once } from '../once.js';
import { finishTask, snoozeTask } from '../remind.js';
import { parseTask } from '../parse.js';
import { HUB_URL, summarizeSlack } from '../slack.js';
import { pushNtfy } from '../../../server/src/integrations/notify.js';
import { learnPeople } from '../people.js';
import { mineFaq } from '../faq.js';
import { learnCorrections } from '../corrections.js';
import { learnVoice } from '../voice.js';
import { acceptAsk, skipAsk } from '../slackSave.js';
import { autopilotConfig, autopilotState, replyHistory, replyNow, saveAutopilot } from '../autopilot.js';
import { errText } from '../../../shared/util.js';
import { body, readJson, send, type Ctx, type Routes } from './http.js';

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

  // Mines a support channel into proposed FAQ claims: POST /slack/faq?channel=name&days=90.
  'POST /slack/people': async ({ res, getDb }) => {
    try {
      send(res, 200, await once('people', () => learnPeople(getDb())));
    } catch (err) {
      send(res, 502, { error: errText(err) });
    }
  },
  'POST /slack/faq': async ({ res, url, getDb }) => {
    const channel = (url.searchParams.get('channel') ?? '').replace(/^#/, '');
    const days = Number(url.searchParams.get('days') ?? 90) || 90;
    if (!channel) return send(res, 400, { error: 'channel is required' });
    try {
      send(res, 200, await once(`faq:${channel}`, () => mineFaq(getDb(), channel, days)));
    } catch (err) {
      send(res, 502, { error: errText(err) });
    }
  },

  // Learns how I write from my own Slack messages, for the drafts: POST /slack/voice.
  'POST /slack/voice': async ({ res, getDb }) => {
    try {
      send(res, 200, await once('voice', () => learnVoice(getDb())));
    } catch (err) {
      send(res, 502, { error: errText(err) });
    }
  },

  // Turns my edits and skips of drafts into rules for the drafter: POST /slack/corrections.
  'POST /slack/corrections': async ({ res, getDb }) => {
    try {
      send(res, 200, await once('corrections', () => learnCorrections(getDb())));
    } catch (err) {
      send(res, 502, { error: errText(err) });
    }
  },

  'GET /autopilot': ({ res, getDb }) => send(res, 200, autopilotState(getDb())),
  'GET /history': ({ res, url, getDb }) => send(res, 200, { replies: replyHistory(getDb(), url.searchParams.get('who') ?? '') }),
  'POST /autopilot': async (c) => {
    const data = await body<Record<string, unknown>>(c, 20_000);
    if (!data) return;
    const db = c.getDb();
    saveAutopilot(db, { ...autopilotConfig(db), ...data });
    send(c.res, 200, autopilotState(db));
  },

  'POST /slack/accept': accept('slack', 'Slack'),
  'POST /slack/skip': ({ res, url, getDb }) => {
    const id = url.searchParams.get('id') ?? '';
    const ok = skipAsk(getDb(), id, url.searchParams.get('reason') ?? '');
    console.log(`slack skip ${id}: ${ok ? 'skipped' : 'no such ask'}`);
    send(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such Slack task' });
  },
  'POST /slack/reply': async ({ req, res, url, getDb }) => {
    const id = url.searchParams.get('id') ?? '';
    const edited = url.searchParams.get('edited') === '1';
    // A push action posts no body, the app posts the draft as it reads on the phone.
    const data = (await readJson(req, 20_000).catch(() => null)) as { text?: string } | null;
    const text = typeof data?.text === 'string' ? data.text : undefined;
    const run = () => once(`reply:${id}`, () => replyNow(getDb(), autopilotConfig(getDb()), id, Date.now(), undefined, edited, text));
    // The post takes longer than a push action waits, so a push gets 202 at once and the result comes as a second push.
    if (text === undefined) {
      send(res, 202, { ok: true });
      run().then(
        (r) => {
          console.log(`slack reply ${id} (push): ${r?.status ?? 'no draft'}`);
          if (r && r.status !== 'sent') void pushNtfy(r.status === 'answered' ? 'Not sent: someone answered first' : 'Not sent: the thread changed', '', '', r.url ?? '');
          else if (r) void pushNtfy('Reply sent', '', '', r.url ?? '');
          else void pushNtfy('Not sent: no draft for this ask', '', '', '');
        },
        (err) => {
          console.error(`slack reply ${id} (push): ${errText(err)}`);
          void pushNtfy('Reply not sent', '', errText(err), '', `http, Retry, ${HUB_URL}/slack/reply?id=${encodeURIComponent(id)}, method=POST, clear=true`);
        },
      );
      return;
    }
    try {
      const r = await run();
      console.log(`slack reply ${id}: ${r?.status ?? 'no draft'}`);
      send(res, r ? 200 : 404, r ?? { error: 'No Slack ask with a draft' });
    } catch (err) {
      console.error(`slack reply ${id}: ${errText(err)}`);
      send(res, 502, { error: errText(err) });
    }
  },
  'POST /gmail/accept': accept('gmail', 'Gmail'),
};
