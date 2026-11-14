import { useStore } from '../app/store';

export function useChatRun(chat?: string) {
  return useStore((s) => (chat ? s.runs.find((r) => r.chatId === chat && r.state !== 'done') : undefined));
}
