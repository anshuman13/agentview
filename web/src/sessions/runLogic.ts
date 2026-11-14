import type { ChatRun, LiveChat, LiveNow, RoundOutcome } from '../../../shared/protocol';
import { firstRound, nextRound, roundText, runLine as roundLine } from '../../../shared/goalText';

const ENDED: Record<string, string> = { passed: 'Build cycle passed', failed: 'Build cycle stopped' };

const KIND: Record<ChatRun['kind'], string> = { loop: 'Loop', goal: 'Goal', cycle: 'Build cycle', tries: 'Tries', job: 'Job' };

export function runLine(run: ChatRun, phase: string | null = null) {
  if (run.state === 'paused') return run.why ? `Paused · ${run.why}` : 'Paused';
  if (run.kind === 'goal') return roundLine(KIND.goal, run);
  if (run.kind === 'tries') return `Tries · ${run.tries?.filter((t) => !t.dropped).length ?? 0} chats`;
  if (run.kind === 'job') return `Job · ${run.branch}`;
  if (run.kind === 'cycle') return `Build cycle · round ${run.round}/${run.max}${phase && phase !== 'passed' && phase !== 'failed' ? ` · ${phase[0].toUpperCase()}${phase.slice(1)}` : ''}`;
  return roundLine(KIND.loop, run);
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

export type LoopNow = { title: string; at: number | null; source: 'status' | 'round' | 'none'; next?: string; stepsLeft?: number };

// What the loop card's first row shows: the agent's status or the last round, whichever is newer. A status from before the run started is ignored.
export function loopNow(run: ChatRun, now?: LiveNow): LoopNow {
  const last = run.rounds.at(-1);
  if (now && now.at >= run.startedAt && (!last || now.at >= last.at)) {
    return { title: now.text, at: now.at, source: 'status', ...(now.next?.length && { next: now.next[0], stepsLeft: now.next.length }) };
  }
  if (last) return { title: roundText(last), at: null, source: 'round' };
  return { title: firstRound(run.nextAt), at: null, source: 'none' };
}

// How long an agent has run, as "12 min" or "1 h 5 min".
export function agentAge(startedAt: number, now: number) {
  const min = Math.max(1, Math.floor((now - startedAt) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export const stoppedText = (run: ChatRun, running: boolean) => `${KIND[run.kind]} stopped${running && run.round > 0 && (run.kind === 'goal' || run.kind === 'loop') ? ` · round ${run.round} was running` : ''}`;

export const OUTCOME_DOT: Record<RoundOutcome, string> = { blocked: 'warn', question: 'warn', failed: 'bad', done: 'ok', quiet: '', progress: '' };


export const loopOpenByDefault = (run: ChatRun, working: boolean, waiting: boolean) => working || waiting || run.needsYou;

export const loopLabel = (loop: { phase: string | null; round: number; max: number }) => (loop.phase ? ENDED[loop.phase] ?? `Build cycle${loop.max > 1 ? ` · round ${loop.round}/${loop.max}` : ''}` : '');
