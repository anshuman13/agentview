import { MAX_GOAL_ROUNDS, type ChatRun, type Round } from './protocol.js';
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

// The meta of a finished run: why it ended, capitalised, and when. Null when the run has no reason.
export const finishedLine = ({ why, endedAt }: { why: string; endedAt: number | null }, ago: (t: number) => string) =>
  why ? `${why[0].toUpperCase()}${why.slice(1)}${endedAt ? ` · ${ago(endedAt)}` : ''}` : null;

const roundOutcome = ({ outcome, line }: Pick<Round, 'outcome' | 'line'>) => (outcome === 'quiet' ? 'nothing to do' : line ? `${outcome}: ${line}` : outcome);

export const roundText = ({ n, at, outcome, line }: Pick<Round, 'n' | 'at' | 'outcome' | 'line'>) =>
  `Round ${n} · ${clock(at)} · ${roundOutcome({ outcome, line })}`;

export type RoundGroup = { first: Round; last: Round; count: number; costUsd: number };

// Rounds in time order with each run of consecutive quiet rounds (not a weekly report) merged into one group.
export function mergeQuiet(rounds: Round[]): RoundGroup[] {
  const groups: RoundGroup[] = [];
  for (const r of rounds) {
    const g = groups[groups.length - 1];
    if (g && r.outcome === 'quiet' && !r.report && g.last.outcome === 'quiet' && !g.last.report) {
      g.last = r;
      g.count++;
      g.costUsd += r.costUsd;
    } else groups.push({ first: r, last: r, count: 1, costUsd: r.costUsd });
  }
  return groups;
}

export const roundGroupText = (g: RoundGroup) =>
  g.count > 1 ? `Rounds ${g.first.n}-${g.last.n} · ${clock(g.last.at)} · nothing to do` : g.last.report ? 'Weekly report' : roundText(g.last);

export const firstRound = (at: number | null) => `First round${at ? ` ${clock(at)}` : ''}`;

export const nextRound = (at: number | null) => `Next round${at ? ` ${clock(at)}` : ''}`;

export const skipText = (why: string) => `Skipped: ${why}`;

export const goalMet = (n: number) => `Goal met after ${rounds(n)}`;

export const goalStoppedAt = (at: number, n: number, commits = 0) => `Stopped at ${clock(at)} · ${rounds(n)}${commits ? ` · ${commits} ${commits === 1 ? 'commit' : 'commits'}` : ''}`;

export const goalCapReached = (pct: number) => `Usage cap ${pct}% reached`;

export const goalNotMet = (n: number) => `Not met after ${rounds(n)}`;

export const GOAL_RAN_OUT = 'Ran for 28 days, start it again to continue';

// A run's build limit as its rows show it; empty without one.
export const buildsLine = (run: Pick<ChatRun, 'builds' | 'maxBuilds'>): string => (run.maxBuilds ? `Builds ${run.builds ?? 0} of ${run.maxBuilds}` : '');
