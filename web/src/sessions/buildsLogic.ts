import type { BadgeSpec } from '../ui/Badge';
import { stageName, type BuildDetail, type BuildState, type Criterion } from '../../../shared/builds';
import { span } from '../../../shared/util';

type Entry = BuildDetail['entries'][number];

export const stateDot = (state: BuildState) => ({ done: 'ok', failed: 'bad', waiting: 'warn', running: '' })[state];

export const stateBadge = (state: BuildState): BadgeSpec => ({ status: state });

export const stageBadge = (e: Entry): BadgeSpec => ({ status: e.status === 'stopped' ? 'skipped' : e.status });

export const criterionBadge = (c: Criterion): BadgeSpec => ({ status: c.result === 'pass' ? 'done' : c.result === 'fail' ? 'failed' : 'skipped' });

export const stageTitle = (e: Entry) => stageName(e.stage) + (e.round > 1 ? ` · round ${e.round}` : '');

export const byStart = (entries: Entry[]) => entries.map((e, i) => [e, i] as const).sort((a, b) => a[0].startedAt - b[0].startedAt || a[1] - b[1]).map(([e]) => e);

export const updatedAt = (entries: Entry[]) => Math.max(0, ...entries.map((e) => e.endedAt ?? e.startedAt));

export function stageMeta(e: Entry) {
  const ms = e.endedAt ? e.endedAt - e.startedAt : 0;
  const took = e.endedAt && (ms < 60_000 ? `${Math.round(ms / 1000)}s` : span(ms));
  return [e.verdict && e.verdict[0].toUpperCase() + e.verdict.slice(1), took].filter(Boolean).join(' · ');
}

export function testCounts(criteria: Criterion[]) {
  const count = (result: Criterion['result']) => criteria.filter((c) => c.result === result).length;
  return ([['done', count('pass')], ['failed', count('fail')]] as const).filter(([, n]) => n).map(([status, count]) => ({ status, count }));
}

export const commitTotals = (files: { add: number; del: number }[]) => ({ add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) });
