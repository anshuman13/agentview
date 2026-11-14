import { MAX_GOAL_ROUNDS, type Round } from './protocol.js';
import { clock } from './util.js';

export const rounds = (n: number) => `${n} ${n === 1 ? 'round' : 'rounds'}`;

export const interval = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000} h` : `${Math.round(ms / 60_000)} min`);

// The system note of a goal that starts or changes: how often, until when, the usage cap and the build limit. An edit also says "no cap" and "no build limit".
export function goalPlan({ every, endAt, capPct, maxBuilds }: { every: number; endAt?: number; capPct?: number; maxBuilds?: number }, edit = false) {
  const head = `${every ? `Goal every ${interval(every)}` : 'Goal when idle'}${endAt ? ` until ${clock(endAt)}` : ''}`;
  return [head, !every && `up to ${rounds(MAX_GOAL_ROUNDS)}`, capPct ? `cap ${capPct}%` : edit && 'no cap', maxBuilds ? `builds ${maxBuilds}` : edit && 'no build limit'].filter(Boolean).join(' · ');
}

export const runLine = (word: string, { round, max, nextAt }: { round: number; max: number; nextAt: number | null }) =>
  `${word} · round ${round}${max ? ` of ${max}` : ''}${nextAt ? ` · next ${clock(nextAt)}` : ''}`;

const roundOutcome = ({ outcome, line }: Pick<Round, 'outcome' | 'line'>) => (outcome === 'quiet' ? 'nothing to do' : line ? `${outcome}: ${line}` : outcome);

export const roundText = ({ n, at, outcome, line }: Pick<Round, 'n' | 'at' | 'outcome' | 'line'>) =>
  `Round ${n} · ${clock(at)} · ${roundOutcome({ outcome, line })}`;

// The run row's last round: a weekly report by name; the outcome alone when the row's run line already says this round; else the full round text.
export const lastRoundText = (run: { kind: string; state: string; round: number }, r: Pick<Round, 'n' | 'at' | 'outcome' | 'line' | 'report'>) =>
  r.report ? 'Weekly report' : (run.kind === 'goal' || run.kind === 'loop') && run.state !== 'paused' && r.n === run.round ? roundOutcome(r) : roundText(r);

export const firstRound = (at: number | null) => `First round${at ? ` ${clock(at)}` : ''}`;

export const nextRound = (at: number | null) => `Next round${at ? ` ${clock(at)}` : ''}`;

export const skipText = (why: string) => `Skipped: ${why}`;

export const goalMet = (n: number) => `Goal met after ${rounds(n)}`;

export const goalStoppedAt = (at: number, n: number, commits = 0) => `Stopped at ${clock(at)} · ${rounds(n)}${commits ? ` · ${commits} ${commits === 1 ? 'commit' : 'commits'}` : ''}`;

export const goalCapReached = (pct: number) => `Usage cap ${pct}% reached`;

export const goalNotMet = (n: number) => `Not met after ${rounds(n)}`;

export const GOAL_RAN_OUT = 'Ran for 28 days, start it again to continue';
