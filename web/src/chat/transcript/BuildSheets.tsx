import { createPortal } from 'react-dom';
import { useState } from 'react';
import { useStore } from '../../app/store';
import { Markdown } from '../Chat';
import { Badge } from '../../ui/Badge';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import { ago } from '../../ui/util';
import { Capped } from '../../codex/Fold';
import { BuildPhases } from '../../sessions/BuildPhases';
import { CodeReview, Implementation, ReportBody } from '../../sessions/BuildParts';
import { FLOW_LABEL, byStart, criterionBadge, stageBadge, stageMeta, stageTitle, testCounts } from '../../sessions/buildsLogic';
import type { BuildDetail, BuildStage, FlowStep, ReviewPhase, SpecCriterion } from '../../../../shared/builds';

type StepKey = Exclude<FlowStep['key'], 'spec' | 'approval' | 'merge'>;
export type OpenSheet = { kind: 'spec'; initial?: ReviewPhase } | { kind: 'step'; key: StepKey } | { kind: 'criterion'; n: number };

const STAGE: Record<StepKey, BuildStage> = { 'spec-review': 'review', implement: 'implement', test: 'test', 'code-review': 'code-review' };

// The open sheets, the topmost last; closing one returns focus to the Row that opened it.
export function useBuildSheets() {
  const [stack, setStack] = useState<(OpenSheet & { from: HTMLElement | null })[]>([]);
  return {
    stack,
    open: (sheet: OpenSheet, from?: HTMLElement) => setStack((s) => [...s, { ...sheet, from: from ?? null }]),
    close: () => { stack.at(-1)?.from?.focus(); setStack((s) => s.slice(0, -1)); },
  };
}

export type BuildSheetState = ReturnType<typeof useBuildSheets>;

function CriterionRow({ c, onOpen }: { c: SpecCriterion; onOpen: (from: HTMLElement) => void }) {
  const badge = criterionBadge(c);
  return <Row className="bd-clamp" title={c.text} meta={`${c.ui ? 'UI · ' : ''}${c.evidence || 'Not tested'}`} state={badge && <Badge {...badge} />} onClick={(e) => onOpen(e.currentTarget)} />;
}

export function Criteria({ criteria, limit, onOpen }: { criteria: SpecCriterion[]; limit: number; onOpen: (n: number, from: HTMLElement) => void }) {
  if (!criteria.length) return null;
  return (
    <>
      <Section label="Acceptance criteria" action={testCounts(criteria).map((c) => <Badge key={c.status} {...c} />)} />
      <div className="ui-group">
        <Capped items={criteria} limit={limit} render={(c) => <CriterionRow key={c.n} c={c} onOpen={(from) => onOpen(c.n, from)} />} />
      </div>
    </>
  );
}

function SpecSheet({ d, initial, reload }: { d: BuildDetail; initial?: ReviewPhase; reload: () => Promise<void> }) {
  const cwd = useStore((s) => s.session.cwd);
  if (!d.phases.length) return <><Section label="Spec" /><EmptyState size="sm" title="No spec phases yet" /></>;
  return <BuildPhases slug={d.slug} phases={d.phases} reviews={d.reviews} specPath={d.specFile && `${cwd}/${d.specFile}`} initial={initial} hideCriteria onSaved={reload} />;
}

function StepSheet({ d, step, reload, sheets }: { d: BuildDetail; step: StepKey; reload: () => Promise<void>; sheets: BuildSheetState }) {
  const chat = useStore((s) => s.session.id);
  const [picked, setPicked] = useState<string | null>(null);
  const runs = byStart(d.entries).filter((e) => e.stage === STAGE[step]).reverse();
  const run = runs.find((e) => e.id === picked) ?? runs[0];
  return (
    <>
      <Section label={FLOW_LABEL[step]} count={sectionCount(runs.length)} />
      {run ? (
        <div className="ui-group">
          {runs.map((e) => <Row key={e.id} title={stageTitle(e)} meta={stageMeta(e) || ago(e.startedAt, ' ago')} state={<Badge {...stageBadge(e)} />} onClick={() => setPicked(e.id)} />)}
        </div>
      ) : <EmptyState size="sm" title="No runs yet" />}
      {step === 'implement' && <Implementation d={d} />}
      {step === 'code-review' && <CodeReview d={d} onSaved={reload} />}
      {step === 'test' && <Criteria criteria={d.criteria} limit={d.criteria.length} onOpen={(n, from) => sheets.open({ kind: 'criterion', n }, from)} />}
      {run && <ReportBody report={{ title: stageTitle(run), text: run.report, chat: run.chat !== chat ? { id: run.chat, session: run.session } : undefined }} onOpened={sheets.close} />}
    </>
  );
}

function CriterionSheet({ c }: { c: SpecCriterion }) {
  return (
    <>
      <Section label={`Criterion ${c.n}`} />
      <div className="bd-doc"><Markdown text={c.text} /></div>
      {c.ui && <div className="ui-group"><Row plain title="UI check" /></div>}
      <div className="bd-doc"><Markdown text={c.evidence || 'Not tested yet'} /></div>
    </>
  );
}

export function BuildSheets({ d, sheets, reload }: { d: BuildDetail; sheets: BuildSheetState; reload: () => Promise<void> }) {
  return (
    <>
      {sheets.stack.map((s, i) => {
        const c = s.kind === 'criterion' ? d.criteria.find((x) => x.n === s.n) : undefined;
        if (s.kind === 'criterion' && !c) return null;
        const label = s.kind === 'spec' ? 'Spec' : s.kind === 'step' ? FLOW_LABEL[s.key] : `Criterion ${s.n}`;
        return createPortal(
          <Sheet label={label} onClose={sheets.close} className="gl-sheet">
            {s.kind === 'spec' && <SpecSheet d={d} initial={s.initial} reload={reload} />}
            {s.kind === 'step' && <StepSheet d={d} step={s.key} reload={reload} sheets={sheets} />}
            {c && <CriterionSheet c={c} />}
          </Sheet>,
          document.body,
          String(i),
        );
      })}
    </>
  );
}
