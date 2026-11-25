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
    const job = runs.jobOfSession(s.sessionId);
    if (job) runs.update(job.id, { chatId: chat.id });
    const build = runs.list().find((r) => r.kind === 'build' && r.state !== 'done' && r.sessionId === s.sessionId);
    if (build) runs.update(build.id, { chatId: chat.id });
    if (s.crons.length) chat.wakeups.restore(s.crons);
    if (s.stopped) chat.resumeStopped(s.stopped);
    for (const q of s.queued ?? []) void chat.prompt(q.text, q.id);
  }));
  await rm(RESTORE, { force: true });
  // A run has no chat to go on in after a restart; a job run stays while its chat came back or it waits for review.
  const sessions = new Set([...live.values()].map(({ chat }) => chat.state.session.sessionId));
  const jobs = runs.list().filter((r) => (r.kind === 'job' && r.review === 'pending') || ((r.kind === 'job' || r.kind === 'build') && sessions.has(r.sessionId))).map((r) => r.id);
  runs.endExcept(jobs, 'AgentView restarted');
  // A build run between two steps sends its next one.
  for (const { chat } of live.values()) chat.build?.kick();
  saveSoon();
  return (saved.view && bySession(saved.view)) || null;
}
