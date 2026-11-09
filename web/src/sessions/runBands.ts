import type { ChatEvent, ChatRun } from '../../../shared/protocol';
import type { BadgeSpec } from '../ui/Badge';
import { useStore } from '../app/store';
import type { Job } from '../codex/data/wiki';

const WAITING = 'waiting for your approval';

export type RunItem = { kind: 'run'; run: ChatRun } | { kind: 'job'; job: Job; state: BadgeSpec };

export function lastUserAt(events: ChatEvent[]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'user' && !e.auto) return e.at;
  }
  return 0;
}

// A blocked or question round, or a pause for approval, until a later round or a message from the user in that chat.
export function needsYou(run: ChatRun, userAt = 0) {
  if (run.state === 'done') return false;
  if (run.state === 'paused' && run.why === WAITING) return true;
  const last = run.rounds.at(-1);
  return !!last && (last.outcome === 'blocked' || last.outcome === 'question') && last.at > userAt;
}

const FINISHED = 30;

export function runBands(runs: ChatRun[], jobs: { job: Job; state: BadgeSpec | null }[], userAt: (chat: string) => number) {
  const active = runs.filter((r) => r.state !== 'done');
  const entry = (run: ChatRun): RunItem => ({ kind: 'run', run });
  const needs = active.filter((r) => needsYou(r, userAt(r.chatId))).map(entry);
  const running = active.filter((r) => !needsYou(r, userAt(r.chatId))).map(entry);
  for (const { job, state } of jobs) {
    if (state?.status === 'failed') needs.push({ kind: 'job', job, state });
    else if (state?.status === 'running' || (state?.status === 'waiting' && state.reason === 'Queued')) running.push({ kind: 'job', job, state });
  }
  const finished = runs.filter((r) => r.state === 'done').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, FINISHED);
  return { needs, running, finished };
}

export function useChatRun(chat?: string) {
  const run = useStore((s) => (chat ? s.runs.find((r) => r.chatId === chat && r.state !== 'done') : undefined));
  const userAt = useStore((s) => (chat && s.session.id === chat ? lastUserAt(s.events) : 0));
  return run && { run, needs: needsYou(run, userAt) };
}
