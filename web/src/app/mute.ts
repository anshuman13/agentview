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

export const isMuted = (sessionId: string | null | undefined) => !!sessionId && read().includes(sessionId);

export function setMuted(sessionId: string, on: boolean) {
  const rest = read().filter((x) => x !== sessionId);
  try { localStorage.setItem(KEY, JSON.stringify(on ? [...rest, sessionId] : rest)); } catch {}
}
