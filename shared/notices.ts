import type { LiveChat } from './protocol';
import { providerLabel } from './providers';

export type NoticeKind = 'approval' | 'finished' | 'failed';
export type ChatNotice = { kind: NoticeKind; title: string; body: string; sub?: string };

const repoOf = (c: LiveChat) => c.cwd.replace(/\/+$/, '').split('/').pop() ?? '';

// The one notice a chat's live-list change earns: a new request, a failure, or a finished chat with its reply line. The chat of a run stays silent: the run reports.
export function chatNotices(before: LiveChat, now: LiveChat, muted: boolean): ChatNotice | null {
  const who = providerLabel(now.provider);
  const repo = repoOf(now);
  if (now.pending > before.pending) return { kind: 'approval', title: `${who} needs you in ${repo}`, body: now.title };
  if (now.failed && !before.failed) return { kind: 'failed', title: `${who} failed in ${repo}`, body: now.title };
  if (muted) return null;
  if (now.run || !before.running || now.running || now.failed) return null;
  const title = `${who} finished in ${repo}`;
  return now.last ? { kind: 'finished', title, body: now.last, sub: now.title } : { kind: 'finished', title, body: now.title };
}

// The notice per chat in a new live list that was already known; the chat on screen earns one like any other.
export const backgroundNotices = (was: LiveChat[], now: LiveChat[], isMuted: (sessionId: string | null) => boolean) =>
  now.flatMap((c) => {
    const before = was.find((x) => x.id === c.id);
    const n = before && chatNotices(before, c, isMuted(c.sessionId));
    return n ? [{ id: c.id, notice: n }] : [];
  });
