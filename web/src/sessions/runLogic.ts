import type { ChatRun, LiveChat, LiveNow, RoundOutcome } from '../../../shared/protocol';
import { clock } from '../../../shared/util';
import { hhmm } from '../../../shared/build';
import { plural } from '../ui/util';
import { firstRound, nextRound, roundText } from '../../../shared/runText';

const KIND: Record<ChatRun['kind'], string> = { tries: 'Tries', job: 'Job', build: 'Build' };

export function runLine(run: ChatRun) {
  if (run.state === 'paused') return run.why ? `Paused · ${run.why}` : 'Paused';
  if (run.kind === 'tries') return `Tries · ${run.tries?.filter((t) => !t.dropped).length ?? 0} chats`;
  if (run.kind === 'build') return buildLine(run);
  return `Job · ${run.branch}`;
}

// "Build · 3 of 7 done · until 06:00", or what it waits for.
export function buildLine(run: Pick<ChatRun, 'progress' | 'until' | 'phase' | 'why'>) {
  if (run.why) return `Build · ${run.why}`;
  const step = run.phase === 'spec' ? 'writing the spec' : run.phase === 'recap' ? 'writing the recap' : run.phase === 'more' ? 'finding more work' : `${run.progress ?? '0 of 0'} done`;
  return `Build · ${step}${run.until ? ` · until ${hhmm(run.until)}` : ''}`;
}

// The build chat's header line: "Task 4 of 7 · <task> · until 06:00", or the step it is on. Null for other runs.
export function buildHead(run: Pick<ChatRun, 'kind' | 'phase' | 'progress' | 'task' | 'until'>) {
  if (run.kind !== 'build') return null;
  const [done, total] = (run.progress ?? '').split(' of ').map(Number);
  const task = !total ? 'Starting' : done >= total ? `All ${total} tasks done` : [`Task ${done + 1} of ${total}`, run.task].filter(Boolean).join(' · ');
  const step = run.phase === 'spec' ? 'Writing the spec' : run.phase === 'recap' ? 'Writing the recap' : run.phase === 'more' ? 'Finding more work' : task;
  return `${step}${run.until ? ` · until ${hhmm(run.until)}` : ''}`;
}

export type HeaderState = { text: string; tone: 'running' | 'needs' | 'failed' | 'warn' | 'idle' };

// The state of a chat for the header: what needs the user first, then the running turn, running agents, the run between rounds.
export function headerState(chat: Pick<LiveChat, 'pending' | 'failed' | 'stalled' | 'running' | 'status' | 'agentList'> & { run?: Pick<NonNullable<LiveChat['run']>, 'state' | 'why' | 'nextAt'> }): HeaderState {
  const agents = chat.agentList?.length ?? 0;
  const { run } = chat;
  if (chat.pending > 0) return { text: 'Needs you', tone: 'needs' };
  if (chat.failed) return { text: 'Failed', tone: 'failed' };
  if (chat.stalled) return { text: 'No activity for 15 min', tone: 'failed' };
  if (chat.running) return { text: chat.status && chat.status !== 'Idle' ? chat.status : 'Working', tone: 'running' };
  if (agents) return { text: `Running · ${agents} ${agents === 1 ? 'agent' : 'agents'}`, tone: 'running' };
  if (run?.state === 'paused') return { text: run.why ? `Paused · ${run.why}` : 'Paused', tone: 'warn' };
  if (run) return { text: nextRound(run.nextAt), tone: 'idle' };
  return { text: 'Idle', tone: 'idle' };
}

// The agents chip beside the header line: while agents run, the running count the line shows; else every agent in the chat.
export const agentChipCount = (all: number, running: number) => running || all;

export type LoopNow ={ title: string; at: number | null; source: 'status' | 'round' | 'none'; next?: string; stepsLeft?: number };

// What the run card's first row shows: the agent's status or the last round, whichever is newer. A status from before the run started is ignored.
export function loopNow(run: ChatRun, now?: LiveNow): LoopNow {
  const last = run.rounds.at(-1);
  if (now && now.at >= run.startedAt && (!last || now.at >= last.at)) {
    return { title: now.text, at: now.at, source: 'status', ...(now.next?.length && { next: now.next[0], stepsLeft: now.next.length }) };
  }
  if (last) return { title: roundText(last), at: null, source: 'round' };
  return { title: firstRound(run.nextAt), at: null, source: 'none' };
}

// The meta line of the Now row: the status time, the next step and the steps left.
export const nowMeta = (now: Pick<LoopNow, 'at' | 'next' | 'stepsLeft'>) =>
  [now.at && clock(now.at), now.next && `Next: ${now.next}`, now.stepsLeft && `${plural(now.stepsLeft, 'step')} left`].filter(Boolean).join(' · ');

export const stoppedText = (run: Pick<ChatRun, 'kind'>) => `${KIND[run.kind]} stopped`;

export const OUTCOME_DOT: Record<RoundOutcome, string> = { blocked: 'warn', question: 'warn', failed: 'bad', done: 'ok', quiet: '', progress: '' };


// What a waiting run asked in its last round: the row's meta line carries it after the age.
export const askLine = (run: LiveChat['run']) => (run?.needsYou && (run.outcome === 'question' || run.outcome === 'blocked') ? run.line : undefined);

