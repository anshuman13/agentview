import os from 'node:os';
import path from 'node:path';
import type { ChatRun, LiveChat } from '../../../shared/protocol.js';
import type { AgentSession } from '../session/session.js';
import { Runs } from '../session/runs.js';
import { desktopActive } from '../presence.js';
import { notifyRunEnded, notifyStall, stallWatch } from '../integrations/notify.js';
import { sendWhenChanged } from './changed.js';
import { LearnQueue } from './learnQueue.js';
import { summary } from './summary.js';
import { broadcast, hub, live, viewers } from './state.js';
import { STOPPED_BY_YOU } from '../../../shared/goalText.js';

export const runs = new Runs(path.join(os.homedir(), '.agentview', 'runs.json'), () => broadcastLive(), (run) => {
  const chat = live.get(run.chatId)?.chat;
  if (run.why === STOPPED_BY_YOU || (chat && viewers(chat))) return;
  notifyRunEnded(run, chat ? path.basename(chat.cwd) : '', !desktopActive(hub.desktopAt));
}, (run) => live.get(run.chatId)?.chat.links.compareTries(run));

export const learning = new LearnQueue({ isLive: (id) => live.has(id), titleOf: (chat) => summaryOf(chat).title });

const stalls = stallWatch((id) => {
  const l = live.get(id);
  if (!l) return;
  notifyStall(summaryOf(l.chat));
  broadcastLive();
});

export const seenRunning = (chat: AgentSession, running: boolean) => stalls.seen(chat.id, running);

export const summaryOf = (chat: AgentSession) => summary(chat, { stalled: stalls.stalled(chat.id), run: runs.activeFor(chat.id), refresh: broadcastLive });
export const liveList = () => [...live.values()].map((l) => summaryOf(l.chat)).sort((a, b) => b.lastActive - a.lastActive);

let liveTimer: NodeJS.Timeout | null = null;
let runsSent = -1;
const sendLive = sendWhenChanged((chats: LiveChat[]) => broadcast({ type: 'live', chats }));
const sendRuns = sendWhenChanged((list: ChatRun[]) => broadcast({ type: 'runs', runs: list }));
export function broadcastLive() {
  liveTimer ??= setTimeout(() => {
    liveTimer = null;
    for (const { chat } of live.values()) chat.watchHistory(viewers(chat) > 0);
    sendLive(liveList());
    if (runs.version !== runsSent) {
      runsSent = runs.version;
      sendRuns(runs.shown());
    }
  }, 100);
}
