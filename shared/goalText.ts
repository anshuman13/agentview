import { MAX_GOAL_ROUNDS, type ChatRun, type FiveHour, type Provider, type Round, type RoundOutcome } from './protocol.js';
import { fiveHourFlag } from './goalForm.js';
import { billing } from './providers.js';
import { money } from './cost.js';
import { clock, span } from './util.js';

// The run a chat is on now: its last open run, as on the server (Runs.activeFor).
export const activeRun = (runs: ChatRun[], chatId: string) => runs.filter((r) => r.chatId === chatId && r.state !== 'done').at(-1);

// The chat's latest ended goal or loop while it has no open run, else null (Android endedRun, fixture ended-run.json).
export const endedRun = (runs: ChatRun[], chatId: string) =>
  activeRun(runs, chatId) ? null : (runs.filter((r) => r.chatId === chatId && (r.kind === 'goal' || r.kind === 'loop')).at(-1) ?? null);

export const rounds = (n: number) => `${n} ${n === 1 ? 'round' : 'rounds'}`;

// The system note of a goal that starts or changes: how often, until when, the usage cap, the 5-hour pause and the build limit. An edit also says "no cap" and "no build limit".
export function goalPlan({ every, endAt, capPct, fiveHour, capUsd, maxBuilds }: { every: number; endAt?: number; capPct?: number; fiveHour?: FiveHour; capUsd?: number; maxBuilds?: number }, edit = false) {
  const head = `${every ? `Goal every ${span(every)}` : 'Goal when idle'}${endAt ? ` until ${clock(endAt)}` : ''}`;
  return [head, !every && `up to ${rounds(MAX_GOAL_ROUNDS)}`, capPct ? `cap ${capPct}%` : !capUsd && edit && 'no cap', fiveHour && fiveHourFlag(fiveHour), capUsd ? `cap $${capUsd}` : null, maxBuilds ? `builds ${maxBuilds}` : edit && 'no build limit'].filter(Boolean).join(' · ');
}

// Without a 5-hour value of its own, a goal with a weekly cap pauses at 90% of the 5-hour window.
export const FIVE_HOUR_DEFAULT = 90;

// The 5-hour pause a goal runs with: its own, else the default when it has a weekly cap, else none.
export const fiveHourLimit = ({ fiveHour, capPct }: { fiveHour?: FiveHour | null; capPct?: number | null }) => fiveHour ?? (capPct ? FIVE_HOUR_DEFAULT : null);

// A 5-hour pause as its choice reads: Off, Auto or 95% (Android fiveHourLabel, fixture five-hour.json).
export const fiveHourLabel = (v: FiveHour | null | undefined) => (v === 'auto' ? 'Auto' : v ? `${v}%` : 'Off');

// The run head's 5-hour row; empty without a pause or when the provider has no usage figure (Android fiveHourLine, fixture five-hour.json).
export function fiveHourLine(run: { fiveHour?: FiveHour | null; capPct?: number | null; provider?: Provider }) {
  const limit = billing(run.provider) === 'none' ? null : fiveHourLimit(run);
  return limit === 'auto' ? 'Paces the 5-hour window' : limit ? `Pauses at ${limit}% of the 5-hour window` : '';
}

// Why a round was skipped for the 5-hour window.
export const fiveHourSkip = (limit: FiveHour) => (limit === 'auto' ? 'pacing the 5-hour window' : `5-hour usage over ${limit}%`);

// A run with an end time says so, since it keeps going until then (Android RunsLogic roundLine).
export const runLine = (word: string, { round, max, nextAt, endAt }: { round: number; max: number; nextAt: number | null; endAt?: number | null }) =>
  `${word} · round ${round}${max ? ` of ${max}` : ''}${nextAt ? ` · next ${clock(nextAt)}` : ''}${endAt ? ` · until ${clock(endAt)}` : ''}`;

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

const SUMMARY_ORDER: RoundOutcome[] = ['done', 'progress', 'blocked', 'question', 'failed', 'quiet'];

// How the kept rounds went, by outcome: "2 done · 1 blocked · 8 nothing to do" (Android roundsSummary, fixture rounds-summary.json).
export const roundsSummary = (rounds: Round[]) =>
  SUMMARY_ORDER.map((o) => [o, rounds.filter((r) => r.outcome === o).length] as const)
    .filter(([, n]) => n > 0)
    .map(([o, n]) => `${n} ${o === 'quiet' ? 'nothing to do' : o}`)
    .join(' · ');

// The summary and the rounds' total cost: "2 done · 1 blocked · $0.42" (Android roundsMeta).
export const roundsMeta = (rounds: Round[], provider?: Provider) =>
  `${roundsSummary(rounds)} · ${money(rounds.reduce((sum, r) => sum + r.costUsd, 0), billing(provider))}`;

export const roundGroupText = (g: RoundGroup) =>
  g.count > 1 ? `Rounds ${g.first.n}-${g.last.n} · ${clock(g.last.at)} · nothing to do` : g.last.report ? 'Weekly report' : roundText(g.last);

// A run's rounds as Markdown to paste in a chat or note, oldest first; "" with no rounds (Android roundsMarkdown, fixture rounds-markdown.json).
export const roundsMarkdown = (title: string, rounds: Round[], provider?: Provider) =>
  rounds.length
    ? [`## ${title}`, roundsMeta(rounds, provider), '',...mergeQuiet(rounds).map((g) => `- ${roundGroupText(g)}`)].join('\n')
    : '';

export const firstRound = (at: number | null) => `First round${at ? ` ${clock(at)}` : ''}`;

export const nextRound = (at: number | null) => `Next round${at ? ` ${clock(at)}` : ''}`;

export const skipText = (why: string) => `Skipped: ${why}`;

export const goalMet = (n: number) => `Goal met after ${rounds(n)}`;

export const goalStoppedAt = (at: number, n: number, commits = 0) => `Stopped at ${clock(at)} · ${rounds(n)}${commits ? ` · ${commits} ${commits === 1 ? 'commit' : 'commits'}` : ''}`;

export const goalCapReached = (pct: number) => `Usage cap ${pct}% reached`;

export const goalCostCapReached = (usd: number) => `Stopped at $${usd}`;

export const goalNotMet = (n: number) => `Not met after ${rounds(n)}`;

export const GOAL_RAN_OUT = 'Ran for 28 days, start it again to continue';

export const STOPPED_BY_YOU = 'you stopped it';

// How an ended run ended, from its why: met, stopped at its end time, capped or run out are planned ends (Android goalEnd).
// 'end time' and 'weekly usage cap' are older wordings still in saved runs.
const PLANNED_ENDS = ['goal met', 'stopped at', 'usage cap', 'ran for 28 days', 'end time', 'weekly usage cap'];
export function goalEnd(why: string): 'done' | 'skipped' | 'failed' {
  if (PLANNED_ENDS.some((w) => why.toLowerCase().startsWith(w))) return 'done';
  return why === STOPPED_BY_YOU ? 'skipped' : 'failed';
}

// A run's build limit as its rows show it; empty without one.
export const buildsLine = (run: Pick<ChatRun, 'builds' | 'maxBuilds'>): string => (run.maxBuilds ? `Builds ${run.builds ?? 0} of ${run.maxBuilds}` : '');

// How a run's detail reads: a goal has a condition and edits while it runs, a loop has a prompt and no edits; tries and jobs have no detail (Android runDetail, fixture run-detail.json).
export const runDetail = ({ kind, state }: Pick<ChatRun, 'kind' | 'state'>) => ({
  heading: kind === 'loop' ? 'Loop' : 'Goal',
  what: kind === 'loop' ? 'Prompt' : 'Condition',
  editable: kind === 'goal' && state !== 'done',
  opens: kind === 'goal' || kind === 'loop',
});
