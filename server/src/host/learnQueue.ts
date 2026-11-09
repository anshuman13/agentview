import { hubLearn, learnEvents } from '../integrations/assistant.js';
import { profileOf } from '../agent/claude/accounts.js';
import type { AgentSession } from '../session/session.js';
import { errText } from '../../../shared/util.js';
import { busy } from './restore.js';

const LEARN_WAIT_MS = 5 * 60 * 1000;

type LearnDeps = { isLive: (id: string) => boolean; titleOf: (chat: AgentSession) => string };

export class LearnQueue {
  private timers = new Map<string, NodeJS.Timeout>();
  private posted = new Map<string, number>();

  constructor(private deps: LearnDeps) {}

  // A chat that stays idle for LEARN_WAIT_MS with a user message not posted yet goes to the hub once, to learn what the user taught.
  later(chat: AgentSession) {
    clearTimeout(this.timers.get(chat.id));
    this.timers.set(chat.id, setTimeout(() => {
      this.timers.delete(chat.id);
      this.post(chat);
    }, LEARN_WAIT_MS).unref());
  }

  forget(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.posted.delete(id);
  }

  private post(chat: AgentSession) {
    if (!this.deps.isLive(chat.id) || busy(chat) || chat.state.pending.length) return;
    const since = this.posted.get(chat.id) ?? 0;
    const events = chat.state.events;
    const fresh = events.filter((e) => e.kind === 'user' && !e.auto && e.at > since);
    if (!fresh.length) return;
    // Keyed by the Claude session, which outlives this host's chat id, so the hub's cursor survives a restart.
    hubLearn({ chat: chat.state.session.sessionId ?? chat.id, title: this.deps.titleOf(chat), profile: profileOf(chat.cwd), events: learnEvents(events) })
      .then(() => this.posted.set(chat.id, Math.max(...fresh.map((e) => e.at))))
      .catch((err) => console.error(`learn ${chat.id}:`, errText(err)));
  }
}
