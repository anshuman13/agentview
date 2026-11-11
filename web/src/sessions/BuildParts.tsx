import { useMemo } from 'react';
import { Markdown } from '../chat/Chat';
import { Button } from '../ui/Button';
import { Files, splitDiff } from '../ui/DiffFiles';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import type { BuildDetail, BuildStage } from '../../../shared/builds';
import { DecisionRow } from './BuildPhases';
import { byStart, commitTotals } from './buildsLogic';
import { openChat } from './goalLogic';

export type Report = { title: string; text: string; chat?: { id: string; session: string | null } };

export const latest = (d: BuildDetail, stage: BuildStage) => byStart(d.entries).filter((e) => e.stage === stage).at(-1);
const buildCommit = (d: BuildDetail) => d.commit && latest(d, 'implement')?.commit;

// The build's commit: branch or subject, size, and the changed files with their diffs.
export function Implementation({ d }: { d: BuildDetail }) {
  const diffs = useMemo(() => splitDiff(d.commit?.diff ?? ''), [d.commit?.diff]);
  const commit = buildCommit(d);
  if (!commit || !d.commit) return null;
  const totals = commitTotals(d.commit.files);
  return (
    <>
      <Section label="Implementation" />
      <div className="ui-group">
        <Row plain title={commit.branch ?? commit.subject} meta={`${commit.sha.slice(0, 7)} · ${d.commit.files.length} ${d.commit.files.length === 1 ? 'file' : 'files'} +${totals.add} -${totals.del}`} />
        <Files files={d.commit.files.map((f) => ({ path: f.path, additions: f.add, deletions: f.del }))} diffs={diffs} />
      </div>
    </>
  );
}

// The newest code review's findings and the decision on the code.
export function CodeReview({ d, onSaved }: { d: BuildDetail; onSaved: () => Promise<void> }) {
  const review = latest(d, 'code-review');
  const commit = buildCommit(d);
  if (!review && !commit) return null;
  return (
    <>
      <Section label="Code review" />
      <div className="ui-group">
        {review && (review.findings.length ? review.findings.map((f, i) => <Row key={i} plain lines={2} title={f} />) : <Row plain title="Clean" />)}
        {commit && <DecisionRow slug={d.slug} phase="code" review={d.codeReview ?? undefined} onSaved={onSaved} />}
      </div>
    </>
  );
}

// A run's report, with a button to its chat.
export function ReportBody({ report, onOpened }: { report: Report; onOpened: () => void }) {
  const { chat } = report;
  return (
    <>
      <Section label={report.title} />
      <div className="bd-doc">{report.text.trim() ? <Markdown text={report.text} /> : <EmptyState size="sm" title="No report yet" />}</div>
      {chat && (
        <div className="gl-actions">
          <Button size="sm" onClick={() => { openChat({ chatId: chat.id, sessionId: chat.session }); window.dispatchEvent(new Event('agentview:chat')); onOpened(); }}>Open chat</Button>
        </div>
      )}
    </>
  );
}
