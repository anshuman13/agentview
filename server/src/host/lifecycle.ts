import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSession } from '../session/session.js';
import { busy } from './restore.js';
import { codeHash } from './hash.js';
import { lastActive } from './summary.js';
import { closeChat } from './chats.js';
import { runs } from './listing.js';
import { saveAndExit } from './persist.js';
import { apis, broadcast, hub, live, viewers } from './state.js';

const IDLE_MS = 10 * 60 * 1000;
const ORPHAN_MS = 5 * 60 * 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = () => codeHash(path.join(here, 'main.ts'), [path.resolve(here, '../../package.json')]);
const BOOT_CODE = CODE();

const idle = (chat: AgentSession) => !busy(chat) && chat.crons.length === 0 && !chat.state.session.repeat && !runs.activeFor(chat.id) && chat.state.pending.length === 0 && viewers(chat) === 0 && chat !== hub.lastViewed;

const anyBusy = () => [...live.values()].some(({ chat }) => busy(chat));

export function sweepIdle() {
  let orphaned = 0;
  setInterval(() => {
    for (const { chat } of live.values()) if (idle(chat) && Date.now() - lastActive(chat) > IDLE_MS) closeChat(chat);
    // With no API server for a while (AgentView quit) and nothing running, save the chats and leave.
    orphaned = apis.size ? 0 : orphaned || Date.now();
    if (orphaned && Date.now() - orphaned > ORPHAN_MS && !anyBusy()) saveAndExit();
  }, 60_000);
}

// Only when the host's own code changed on disk, unless forced: restarting the host ends running Claude processes.
export function restart(now: boolean, force: boolean) {
  if (!force && CODE() === BOOT_CODE) return false;
  if (now) return saveAndExit();
  if (hub.restarting) return true;
  broadcast({ type: 'restarting' });
  for (const { chat } of live.values()) chat.repeater.hold();
  // Background agents and tasks live in the Claude process, so they hold the restart too.
  // A turn that never ends (a card nobody answers) must not hold the restart and every loop for good.
  const deadline = Date.now() + 10 * 60_000;
  hub.restarting = setInterval(() => {
    if (Date.now() > deadline || !anyBusy()) saveAndExit();
  }, 1000);
  return true;
}
