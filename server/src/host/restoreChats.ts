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
    if (s.crons.length) chat.wakeups.restore(s.crons);
    if (s.loop) chat.restoreLoop(s.loop);
    if (s.repeat) chat.resumeRepeat(s.repeat);
    if (s.stopped) chat.resumeStopped(s.stopped);
    for (const q of s.queued ?? []) void chat.prompt(q.text, q.id);
  }));
  await rm(RESTORE, { force: true });
  // A run that no restored loop or goal took back has no chat to go on in.
  const taken = [...live.values()].map(({ chat }) => chat.state.session.repeat?.runId).concat(hub.unrestored.map((u) => u.repeat?.runId));
  runs.endExcept(taken, 'AgentView restarted');
  saveSoon();
  return (saved.view && bySession(saved.view)) || null;
}
