import { readFile, rm } from 'node:fs/promises';
import { errText } from '../../../shared/util.js';
import { parseSaved } from './restore.js';
import { openSaved } from './chats.js';
import { runs } from './listing.js';
import { RESTORE, saveSoon } from './persist.js';
import { bySession, hub, live } from './state.js';

// Reopens the chats saved by the last host; returns the one that was in view.
export async function restoreChats() {
  const saved = await readFile(RESTORE, 'utf8').then(parseSaved).catch(() => null);
  if (!saved) return null;
  hub.unrestored = saved.chats.slice();
  await Promise.all(saved.chats.map(async (s) => {
    const chat = await openSaved(s.sessionId).catch((err) => {
      console.error(`could not reopen chat ${s.sessionId}: ${errText(err)}`);
      return null;
    });
    if (!chat) return;
    hub.unrestored = hub.unrestored.filter((u) => u !== s);
    const job = runs.list().find((r) => r.kind === 'job' && r.state !== 'done' && r.sessionId === s.sessionId);
    if (job) runs.update(job.id, { chatId: chat.id });
    if (s.crons.length) chat.wakeups.restore(s.crons);
    if (s.loop) chat.restoreLoop(s.loop);
    if (s.repeat) chat.resumeRepeat(s.repeat);
    if (s.stopped) chat.resumeStopped(s.stopped);
    for (const q of s.queued ?? []) void chat.prompt(q.text, q.id);
  }));
  await rm(RESTORE, { force: true });
  // A run that no restored loop or goal took back has no chat to go on in; a job run stays while its chat can come back.
  const taken = [...live.values()].map(({ chat }) => chat.state.session.repeat?.runId).concat(hub.unrestored.map((u) => u.repeat?.runId));
  const sessions = new Set([...live.values()].map(({ chat }) => chat.state.session.sessionId).concat(hub.unrestored.map((u) => u.sessionId)));
  const jobs = runs.list().filter((r) => r.kind === 'job' && sessions.has(r.sessionId)).map((r) => r.id);
  runs.endExcept([...taken, ...jobs], 'AgentView restarted');
  saveSoon();
  return (saved.view && bySession(saved.view)) || null;
}
