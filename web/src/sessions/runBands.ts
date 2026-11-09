import type { ChatRun } from '../../../shared/protocol';
import type { BadgeSpec } from '../ui/Badge';
import { useStore } from '../app/store';
import type { Job } from '../codex/data/wiki';

export type RunItem = { kind: 'run'; run: ChatRun } | { kind: 'job'; job: Job; state: BadgeSpec };

const FINISHED = 30;

export function runBands(runs: ChatRun[], jobs: { job: Job; state: BadgeSpec | null }[]) {
  const active = runs.filter((r) => r.state !== 'done').sort((a, b) => b.startedAt - a.startedAt);
  const entry = (run: ChatRun): RunItem => ({ kind: 'run', run });
  const needs = active.filter((r) => r.needsYou).map(entry);
  const running = active.filter((r) => !r.needsYou).map(entry);
  for (const { job, state } of jobs) {
    if (state?.status === 'failed') needs.push({ kind: 'job', job, state });
    else if (state?.status === 'running' || (state?.status === 'waiting' && state.reason === 'Queued')) running.push({ kind: 'job', job, state });
  }
  const finished = runs.filter((r) => r.state === 'done').sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)).slice(0, FINISHED);
  return { needs, running, finished };
}

export function useChatRun(chat?: string) {
  return useStore((s) => (chat ? s.runs.find((r) => r.chatId === chat && r.state !== 'done') : undefined));
}
