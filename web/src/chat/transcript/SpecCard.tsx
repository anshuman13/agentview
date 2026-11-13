import { useRef, useState } from 'react';
import { notice, send, setUi, useStore } from '../../app/store';
import { Badge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Menu, MenuItem } from '../../ui/Menu';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Skeleton } from '../../ui/Skeleton';
import { ago } from '../../ui/util';
import { findHere, useWorkspace } from '../../sessions/folders';
import { postBuildHold } from '../../sessions/sessionApi';
import { useBuild } from '../../sessions/useBuilds';
import { currentStep, FLOW_LABEL, flowBadge, holdBadge, stateBadge } from '../../sessions/buildsLogic';
import { useCan } from '../useCan';
import { Findings } from '../../ops/Findings';
import { pipelineLabel, type BuildDetail, type FlowStep } from '../../../../shared/builds';
import { SPEC_REVIEW_COMMAND } from '../../../../shared/specTasks';
import { TranscriptBox } from './Box';
import { readBox } from './boxOpen';
import { BuildSheets, Criteria, useBuildSheets, type BuildSheetState, type OpenSheet } from './BuildSheets';

// The live card of a spec in a chat: where the build stands and which criteria pass, read-only.
export function SpecCard({ slug, path, bump }: { slug: string; path?: string; bump: number }) {
  const chat = useStore((s) => s.session.id);
  const id = `build:${chat}:${slug}`;
  const [open, setOpen] = useState(() => readBox(id, true));
  const { data: d, failed, gone, reload } = useBuild(slug, open, bump);
  const sheets = useBuildSheets();
  const meta = gone ? 'Spec removed' : d && [pipelineLabel(d.pipeline), d.summary.conclusion].filter(Boolean).join(' · ');
  const state = d?.hold ? <Badge {...holdBadge} /> : d?.entries.length ? <Badge {...stateBadge(d.summary.state)} /> : undefined;
  return (
    <>
    <TranscriptBox id={id} defaultOpen onToggle={setOpen} title={d?.title ?? slug} meta={meta} state={state} action={<SpecMenu path={path ?? `.claude/specs/${slug}.md`} d={d} reload={reload} sheets={sheets} />}>
      {!gone && (d
        ? <SpecBody d={d} sheets={sheets} />
        : failed ? <EmptyState size="sm" title="Could not load this build" hint="Try again" action={<Button size="sm" onClick={() => void reload()}>Retry</Button>} /> : <Skeleton />)}
    </TranscriptBox>
    {d && <BuildSheets d={d} sheets={sheets} reload={reload} />}
    </>
  );
}

function SpecMenu({ path, d, reload, sheets }: { path: string; d: BuildDetail | null; reload: () => Promise<void>; sheets: BuildSheetState }) {
  const can = useCan('subagents');
  const cwd = useStore((s) => s.session.cwd);
  const here = findHere(useWorkspace(cwd).folders, cwd);
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const pick = (run: () => void) => () => { setOpen(false); run(); };
  const hold = (slug: string, decision: 'hold' | 'release') => postBuildHold(slug, decision).then(reload, () => notice('Could not save the hold. Try again.'));
  return (
    <span className="ov-more">
      <IconButton ref={more} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <Menu trigger={more} onClose={() => setOpen(false)}>
          {d && <MenuItem onClick={pick(() => sheets.open({ kind: 'spec' }, more.current ?? undefined))}>Open spec</MenuItem>}
          {d?.specFile && here.folder && !here.tree && <MenuItem onClick={pick(() => setUi({ openFile: d.specFile, follow: false }))}>Open spec file</MenuItem>}
          {d && <MenuItem onClick={pick(() => void hold(d.slug, d.hold ? 'release' : 'hold'))}>{d.hold ? 'Release hold' : 'Hold'}</MenuItem>}
          <MenuItem disabled={!can} title={can ? undefined : 'Needs subagents, not in this chat'} onClick={pick(() => send({ type: 'prompt', text: `/${SPEC_REVIEW_COMMAND} ${path}` }))}>Review with fresh eyes</MenuItem>
        </Menu>
      )}
    </span>
  );
}

const OPEN: Partial<Record<FlowStep['key'], (d: BuildDetail) => OpenSheet>> = {
  spec: (d) => ({ kind: 'spec', initial: d.phases.some((p) => p.key === 'requirements') ? 'requirements' : d.phases[0]?.key }),
  sketch: () => ({ kind: 'spec', initial: 'sketch' }),
  approval: () => ({ kind: 'spec' }),
  'spec-review': () => ({ kind: 'step', key: 'spec-review' }),
  implement: () => ({ kind: 'step', key: 'implement' }),
  test: () => ({ kind: 'step', key: 'test' }),
  'code-review': () => ({ kind: 'step', key: 'code-review' }),
};

// The flow as one strip of steps, then the step that matters now as a row.
function SpecBody({ d, sheets }: { d: BuildDetail; sheets: BuildSheetState }) {
  const failed = d.criteria.some((c) => c.result === 'fail');
  const sheetOf = (f: FlowStep) => (f.state !== 'todo' ? OPEN[f.key] : undefined);
  const now = d.summary.state === 'done' ? undefined : currentStep(d.flow);
  const nowSheet = now && sheetOf(now);
  const badge = now && flowBadge(now);
  return (
    <>
      <div className="bd-steps">
        {d.flow.map((f) => {
          const sheet = sheetOf(f);
          return (
            <button key={f.key} className={`bd-step ${f.state} ${f === now ? 'now' : ''}`} disabled={!sheet} title={[FLOW_LABEL[f.key], f.by, f.result, f.at && ago(f.at)].filter(Boolean).join(' · ')} onClick={sheet && ((e) => sheets.open(sheet(d), e.currentTarget))}>
              <FlowMark state={f.state} />{FLOW_LABEL[f.key]}
            </button>
          );
        })}
      </div>
      {now && (
        <div className="ui-group">
          <Row plain={!nowSheet} onClick={nowSheet && ((e) => sheets.open(nowSheet(d), e.currentTarget))} title={FLOW_LABEL[now.key]} meta={[now.by, now.result, now.at && ago(now.at)].filter(Boolean).join(' · ')} state={badge && <Badge {...badge} />} />
        </div>
      )}
      <Criteria criteria={d.criteria} limit={failed ? d.criteria.length : 0} onOpen={(n, from) => sheets.open({ kind: 'criterion', n }, from)} />
      <Findings target={`spec:${d.slug}`} />
    </>
  );
}

const MARK_TONE: Record<string, string> = { done: 'ok', failed: 'err', waiting: 'warn' };

function FlowMark({ state }: { state: FlowStep['state'] }) {
  return state === 'running' ? <span className="dot running" /> : <span className={`bd-flow-mark ${MARK_TONE[state] ?? 'hollow'}`} />;
}

// A spec write that no longer holds the live card, shown plain.
export function SpecRow({ slug, meta }: { slug: string; meta: string }) {
  return (
    <div className="ui-group tr-act">
      <Row plain leading={<Icon name="beaker" />} title={slug} meta={meta} />
    </div>
  );
}
