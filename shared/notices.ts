import type { LiveChat, RoundOutcome } from './protocol';
import { providerLabel } from './providers';

export type NoticeKind = 'approval' | 'finished' | 'failed';
export type ChatNotice = { kind: NoticeKind; title: string; body: string; sub?: string };

const ROUND_NOTICE: RoundOutcome[] = ['done', 'blocked', 'question', 'failed'];

const repoOf = (c: LiveChat) => c.cwd.replace(/\/+$/, '').split('/').pop() ?? '';

// The one notice a chat's live-list change earns: a new request, a failure, a finished chat with its reply line, or a loop or goal round that needs you or ended the run. Rounds that made progress or were quiet stay silent.
export function chatNotices(before: LiveChat, now: LiveChat, muted: boolean): ChatNotice | null {
  const who = providerLabel(now.provider);
  const repo = repoOf(now);
  if (now.pending > before.pending) return { kind: 'approval', title: `${who} needs you in ${repo}`, body: now.title };
  if (now.failed && !before.failed) return { kind: 'failed', title: `${who} failed in ${repo}`, body: now.title };
  if (muted) return null;
  const run = now.run;
  if (run) {
    if (!before.run || run.round <= before.run.round || !run.outcome || !ROUND_NOTICE.includes(run.outcome)) return null;
    return { kind: 'finished', title: `${run.kind === 'goal' ? 'Goal' : 'Loop'} in ${repo}: ${run.outcome}`, body: run.line || now.title };
  }
  if (!before.running || now.running || now.failed) return null;
  const title = `${who} finished in ${repo}`;
  return now.last ? { kind: 'finished', title, body: now.last, sub: now.title } : { kind: 'finished', title, body: now.title };
}
