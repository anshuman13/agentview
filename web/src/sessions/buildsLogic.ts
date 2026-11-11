import type { BadgeSpec } from '../ui/Badge';
import { reviewDecision, stageName, type BuildDetail, type BuildPhase, type BuildReview, type BuildState, type Criterion, type FlowStep, type ReviewPhase } from '../../../shared/builds';
import { span } from '../../../shared/util';

type Entry = BuildDetail['entries'][number];

export const stateBadge = (state: BuildState): BadgeSpec => ({ status: state });

export const holdBadge: BadgeSpec = { status: 'waiting', label: 'Needs you', reason: 'On hold' };

export const stageBadge = (e: Entry): BadgeSpec => ({ status: e.status === 'stopped' ? 'skipped' : e.status });

export const criterionBadge = (c: Criterion): BadgeSpec | null => c.result === 'pending' ? null : { status: c.result === 'pass' ? 'done' : c.result === 'fail' ? 'failed' : 'skipped' };

export const FLOW_LABEL: Record<FlowStep['key'], string> = { spec: 'Spec', 'spec-review': 'Spec review', approval: 'Your approval', implement: 'Implement', test: 'Test', 'code-review': 'Code review', merge: 'Merge' };

export const flowBadge = (s: FlowStep): BadgeSpec | null => s.state === 'todo' ? null : s.state === 'waiting' && (s.key === 'approval' || s.result === 'On hold') ? holdBadge : { status: s.state };

export const stageTitle = (e: Entry) => stageName(e.stage) + (e.round > 1 ? ` · round ${e.round}` : '');

export const byStart = (entries: Entry[]) => entries.map((e, i) => [e, i] as const).sort((a, b) => a[0].startedAt - b[0].startedAt || a[1] - b[1]).map(([e]) => e);

export function stageMeta(e: Entry) {
  const ms = e.endedAt ? e.endedAt - e.startedAt : 0;
  const took = e.endedAt && (ms < 60_000 ? `${Math.round(ms / 1000)}s` : span(ms));
  return [e.verdict && e.verdict[0].toUpperCase() + e.verdict.slice(1), took].filter(Boolean).join(' · ');
}

export function testCounts(criteria: Criterion[]) {
  const count = (result: Criterion['result']) => criteria.filter((c) => c.result === result).length;
  return ([['done', count('pass')], ['failed', count('fail')]] as const).filter(([, n]) => n).map(([status, count]) => ({ status, count }));
}

export const FOLD = 3;

export const startPhase = (phases: BuildPhase[], reviews: BuildReview[]) => (phases.find((p) => reviewDecision(reviews, p.key)?.decision !== 'approve') ?? phases[0]).key;

export const nextPhase = (phases: BuildPhase[], key: ReviewPhase) => phases[phases.findIndex((p) => p.key === key) + 1]?.key ?? key;

export const commitTotals = (files: { add: number; del: number }[]) => ({ add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) });
