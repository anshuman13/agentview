import { getState, notice, prompt, queueNext, send } from '../app/store';
import { advisorOf, type Advisor, type AdvisorId } from '../../../shared/advisors';
import type { ClientMessage } from '../../../shared/protocol';

// Opens a chat and, on the phone layout, shows it.
export const go = (m: ClientMessage) => {
  send(m);
  window.dispatchEvent(new Event('agentview:chat'));
};

export const openAdvisor = (a: Advisor, fresh = false) => go({ type: 'open_advisor', id: a.id, ...(fresh && { fresh }) });

// Opens an advisor's chat, then sends it a prompt once that chat is the one shown.
export function askAdvisor(id: AdvisorId, text: string) {
  go({ type: 'open_advisor', id });
  const started = Date.now();
  const t = setInterval(() => {
    const { session } = getState();
    if (advisorOf(session.cwd)?.id === id) {
      clearInterval(t);
      (session.running ? queueNext : prompt)(text, () => {});
    } else if (Date.now() - started > 15000) {
      clearInterval(t);
      notice(`The ${id} chat did not open. The message was not sent.`);
    }
  }, 150);
}
