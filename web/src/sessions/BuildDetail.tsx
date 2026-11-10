import { useMemo, useState } from 'react';
import { setUi, useStore } from '../app/store';
import { Back } from '../app/touch/back';
import { Markdown } from '../chat/Chat';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { Files, splitDiff } from '../ui/DiffFiles';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ago } from '../ui/util';
import { stageName, type BuildDetail as Detail, type BuildStage } from '../../../shared/builds';
import { BuildPhases } from './BuildPhases';
import { byStart, commitTotals, criterionBadge, decisionTitle, phaseLabel, stageBadge, stageMeta, stageRows, stageTitle, stateBadge, testCounts, updatedAt } from './buildsLogic';
import { findHere, useWorkspace } from './folders';
import { openChat } from './goalLogic';
import { useBuild } from './useBuilds';

type Report = { title: string; text: string; chat?: { id: string; session: string | null } };

export function BuildDetail({ slug, shown, onBack }: { slug: string; shown: boolean; onBack: () => void }) {
  const { data: d, failed, reload } = useBuild(slug, shown);
  const cwd = useStore((s) => s.session.cwd);
  const here = findHere(useWorkspace(cwd).folders, cwd);
  const [report, setReport] = useState<Report | null>(null);
  const diffs = useMemo(() => splitDiff(d?.commit?.diff ?? ''), [d?.commit?.diff]);
  const head = (
    <div className="bd-head">
      <Back close={onBack} />
      <IconButton icon="arrow-left" label="Back" onClick={onBack} />
      <h2 className="bd-title">{d?.title ?? slug}</h2>
    </div>
  );
  if (!d) return <>{head}{failed ? <EmptyState size="sm" title="Could not load this build" hint="Try again" action={<Button size="sm" onClick={() => void reload()}>Retry</Button>} /> : <Skeleton />}</>;

  const stages = byStart(d.entries);
  const rows = stageRows(d.entries, d.reviews);
  const chat = report?.chat;
  const latest = (stage: BuildStage) => stages.filter((e) => e.stage === stage).at(-1);
  const commit = d.commit && latest('implement')?.commit;
  const totals = commitTotals(d.commit?.files ?? []);
  const test = latest('test');
  const review = latest('code-review');
  const when = ago(updatedAt(d.entries), ' ago');
  const openSpec = () => setUi({ openFile: d.specFile, follow: false });
  return (
    <>
      {head}
      <Section label="Conclusion" />
      <div className="ui-group">
        <Row plain title={d.summary.conclusion} meta={`${stageName(d.summary.stage)} · ${when}`} trailing={<Badge {...stateBadge(d.summary.state)} />} />
      </div>
      <BuildPhases
        slug={d.slug}
        phases={d.phases}
        reviews={d.reviews}
        action={d.specFile && here.folder && !here.tree && <IconButton icon="go-to-file" label="Open spec file" size="sm" onClick={openSpec} />}
        onSaved={reload}
      />
      <Section label="Stages" count={sectionCount(rows.length)} />
      <div className="ui-group">
        {rows.map(({ entry: e, review: r }) => e
          ? <Row key={e.id} title={stageTitle(e)} meta={stageMeta(e) || ago(e.startedAt, ' ago')} trailing={<Badge {...stageBadge(e)} />} onClick={() => setReport({ title: stageTitle(e), text: e.report, chat: { id: e.chat, session: e.session } })} />
          : r && <Row key={`${r.phase}-${r.at}`} className="bd-clamp" title={`You · ${phaseLabel(r.phase)}`} meta={r.note || ago(r.at, ' ago')} trailing={<Badge status={r.decision === 'approve' ? 'done' : 'waiting'} />} onClick={() => setReport({ title: `You · ${phaseLabel(r.phase)}`, text: r.note || decisionTitle(r) })} />)}
      </div>
      {commit && d.commit && (
        <>
          <Section label="Implementation" />
          <div className="ui-group">
            <Row plain title={commit.branch ?? commit.subject} meta={`${commit.sha.slice(0, 7)} · ${d.commit.files.length} ${d.commit.files.length === 1 ? 'file' : 'files'} +${totals.add} -${totals.del}`} />
            <Files files={d.commit.files.map((f) => ({ path: f.path, additions: f.add, deletions: f.del }))} diffs={diffs} />
          </div>
        </>
      )}
      {test && (
        <>
          <Section label="Tests" action={testCounts(test.criteria).map((c) => <Badge key={c.status} {...c} />)} />
          <div className="ui-group">
            {test.criteria.length
              ? test.criteria.map((c) => <Row key={c.n} plain className="bd-clamp" title={c.n} meta={c.evidence} trailing={<Badge {...criterionBadge(c)} />} />)
              : <Row plain title="No per-criterion lines in the report" />}
          </div>
        </>
      )}
      {review && (
        <>
          <Section label="Code review" />
          <div className="ui-group">
            {review.findings.length ? review.findings.map((f, i) => <Row key={i} plain lines={2} title={f} />) : <Row plain title="Clean" />}
          </div>
        </>
      )}
      {report && (
        <Sheet label={report.title} onClose={() => setReport(null)} className="gl-sheet">
          <Section label={report.title} />
          <div className="bd-doc">{report.text.trim() ? <Markdown text={report.text} /> : <EmptyState size="sm" title="No report yet" />}</div>
          {chat && (
            <div className="gl-actions">
              <Button size="sm" onClick={() => { openChat({ chatId: chat.id, sessionId: chat.session }); window.dispatchEvent(new Event('agentview:chat')); setReport(null); }}>Open chat</Button>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
