import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import { notice, setUi, useStore } from '../app/store';
import { Back } from '../app/touch/back';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ago } from '../ui/util';
import { decisionTitle, phaseLabel, stageName, type BuildDetail as Detail } from '../../../shared/builds';
import { BuildPhases } from './BuildPhases';
import { CodeReview, Implementation, latest, ReportBody, type Report } from './BuildParts';
import { criterionBadge, holdBadge, stageBadge, stageMeta, stageRows, stageTitle, stateBadge, testCounts } from './buildsLogic';
import { findHere, useWorkspace } from './folders';
import { openChat } from './goalLogic';
import { postBuildHold } from './sessionApi';
import { useBuild } from './useBuilds';

export function BuildDetail({ slug, shown, onBack }: { slug: string; shown: boolean; onBack: () => void }) {
  const { data: d, failed, gone, reload } = useBuild(slug, shown);
  const cwd = useStore((s) => s.session.cwd);
  const here = findHere(useWorkspace(cwd).folders, cwd);
  const [report, setReport] = useState<Report | null>(null);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const hold = (decision: 'hold' | 'release') => postBuildHold(slug, decision).then(reload, () => notice('Could not save the hold. Try again.'));
  const head = (
    <div className="bd-head">
      <Back close={onBack} />
      <IconButton icon="arrow-left" label="Back" onClick={onBack} />
      <h2 className="bd-title">{d?.title ?? slug}</h2>
      {d && (
        <span className="ov-more">
          <IconButton ref={more} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && <Menu trigger={more} onClose={() => setMenu(false)}><MenuItem onClick={() => { setMenu(false); hold(d.hold ? 'release' : 'hold'); }}>{d.hold ? 'Release hold' : 'Hold'}</MenuItem></Menu>}
        </span>
      )}
    </div>
  );
  if (!d) return <>{head}{gone ? <EmptyState size="sm" title="This build was removed" /> : failed ? <EmptyState size="sm" title="Could not load this build" hint="Try again" action={<Button size="sm" onClick={() => void reload()}>Retry</Button>} /> : <Skeleton />}</>;

  const rows = stageRows(d.entries, d.reviews);
  const test = latest(d, 'test');
  const when = ago(d.updatedAt, ' ago');
  const openSpec = () => setUi({ openFile: d.specFile, follow: false });
  return (
    <>
      {head}
      <Section label="Conclusion" />
      <div className="ui-group">
        <Row plain title={d.summary.conclusion} meta={`${stageName(d.summary.stage)} · ${when}`} trailing={d.hold ? <Badge {...holdBadge} /> : d.entries.length ? <Badge {...stateBadge(d.summary.state)} /> : undefined} />
      </div>
      <BuildPhases
        slug={d.slug}
        phases={d.phases}
        reviews={d.reviews}
        specPath={d.specFile && `${cwd}/${d.specFile}`}
        action={d.specFile && here.folder && !here.tree && <IconButton icon="go-to-file" label="Open spec file" size="sm" onClick={openSpec} />}
        onSaved={reload}
      />
      <Section label="Stages" count={sectionCount(rows.length)} />
      <div className="ui-group">
        {rows.map(({ entry: e, review: r }) => e
          ? <Row key={e.id} title={stageTitle(e)} meta={stageMeta(e) || ago(e.startedAt, ' ago')} trailing={<Badge {...stageBadge(e)} />} onClick={() => setReport({ title: stageTitle(e), text: e.report, chat: { id: e.chat, session: e.session } })} />
          : r && <Row key={`${r.phase}-${r.at}`} className="bd-clamp" title={`You · ${phaseLabel(r.phase)}`} meta={r.note || ago(r.at, ' ago')} trailing={<Badge status={r.decision === 'approve' ? 'done' : 'waiting'} />} onClick={() => setReport({ title: `You · ${phaseLabel(r.phase)}`, text: r.note || decisionTitle(r) })} />)}
      </div>
      <Implementation d={d} />
      {test && (
        <>
          <Section label="Tests" action={testCounts(test.criteria).map((c) => <Badge key={c.status} {...c} />)} />
          <div className="ui-group">
            {test.criteria.length
              ? test.criteria.map((c) => { const badge = criterionBadge(c); return <Row key={c.n} plain className="bd-clamp" title={c.n} meta={c.evidence} trailing={badge && <Badge {...badge} />} />; })
              : <Row plain title="No per-criterion lines in the report" />}
          </div>
        </>
      )}
      <CodeReview d={d} onSaved={reload} />
      {report && createPortal(
        <Sheet label={report.title} onClose={() => setReport(null)} className="gl-sheet">
          <ReportBody report={report} onOpened={() => setReport(null)} />
        </Sheet>,
        document.body,
      )}
    </>
  );
}
