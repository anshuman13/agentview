import type { ChatEvent } from './protocol.js';

// Duet's tap-to-answer replies, offered while the chat's last word is a finished question from the agent.
export const QUICK_REPLIES = ['Yes, do that', 'No, leave it', 'Tell me more'];

export function quickReplies(events: ChatEvent[]): string[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'user') return [];
    if (e.kind === 'assistant' && !e.parent) return !e.streaming && e.text.trim().endsWith('?') ? QUICK_REPLIES : [];
  }
  return [];
}
