import { rootOf } from '../store/roots';

// Slack's mute: a muted chat sends no "Claude finished" notification; "needs you" still comes, like a mention.
const KEY = 'agentview.muted';

const read = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

// Muting acts on the chat's root, so every sub-chat of a muted chat is muted too.
export const isMuted = (sessionId: string | null | undefined) => !!sessionId && read().some((x) => x === sessionId || x === rootOf(sessionId));

export function setMuted(sessionId: string, on: boolean) {
  const root = rootOf(sessionId);
  const rest = read().filter((x) => x !== sessionId && x !== root);
  try { localStorage.setItem(KEY, JSON.stringify(on ? [...rest, root] : rest)); } catch {}
}
