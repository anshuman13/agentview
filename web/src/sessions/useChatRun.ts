import { useStore } from '../app/store';
import { activeRun } from '../../../shared/runText';

export function useChatRun(chat?: string) {
  return useStore((s) => (chat ? activeRun(s.runs, chat) : undefined));
}
