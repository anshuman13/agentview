import { send } from '../app/store';
import type { Advisor, AdvisorId } from '../../../shared/advisors';
import type { ClientMessage } from '../../../shared/protocol';

// Opens a chat and, on the phone layout, shows it.
export const go = (m: ClientMessage) => {
  send(m);
  window.dispatchEvent(new Event('agentview:chat'));
};

export const openAdvisor = (a: Advisor, fresh = false) => go({ type: 'open_advisor', id: a.id, ...(fresh && { fresh }) });

// Opens an advisor's chat with a prompt; the server queues it behind a running turn and sends it to the hub Mac when advisors run there.
export const askAdvisor = (id: AdvisorId, text: string) => go({ type: 'open_advisor', id, text });
