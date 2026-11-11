import { useRef, useState } from 'react';
import { send, useStore } from '../../app/store';
import { Badge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Menu, MenuItem } from '../../ui/Menu';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Skeleton } from '../../ui/Skeleton';
import { ago } from '../../ui/util';
import { Capped } from '../../codex/Fold';
import { useBuild } from '../../sessions/useBuilds';
import { FLOW_LABEL, FOLD, criterionBadge, flowBadge, holdBadge, stateBadge, testCounts } from '../../sessions/buildsLogic';
import { useCan } from '../useCan';
import { Findings } from '../../ops/Findings';
import { pipelineLabel, type BuildDetail } from '../../../../shared/builds';
import { SPEC_REVIEW_COMMAND } from '../../../../shared/specTasks';
import { TranscriptBox } from './Box';
import { readBox } from './boxOpen';

// The live card of a spec in a chat: where the build stands and which criteria pass, read-only.
export function SpecCard({ slug, path, bump }: { slug: string; path?: string; bump: number }) {
  const chat = useStore((s) => s.session.id);
  const id = `build:${chat}:${slug}`;
  const [open, setOpen] = useState(() => readBox(id, true));
  const { data: d, failed, gone, reload } = useBuild(slug, open, bump);
  const meta = gone ? 'Spec removed' : d && [pipelineLabel(d.pipeline), d.summary.conclusion].filter(Boolean).join(' · ');
  const state = d?.hold ? <Badge {...holdBadge} /> : d?.entries.length ? <Badge {...stateBadge(d.summary.state)} /> : undefined;
  return (
    <TranscriptBox id={id} defaultOpen onToggle={setOpen} title={d?.title ?? slug} meta={meta} state={state} action={<SpecMenu path={path ?? `.claude/specs/${slug}.md`} />}>
      {!gone && (d
        ? <SpecBody d={d} />
        : failed ? <EmptyState size="sm" title="Could not load this build" hint="Try again" action={<Button size="sm" onClick={() => void reload()}>Retry</Button>} /> : <Skeleton />)}
    </TranscriptBox>
  );
}

function SpecMenu({ path }: { path: string }) {
  const can = useCan('subagents');
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  return (
    <span className="ov-more">
      <IconButton ref={more} size="sm" icon="kebab-vertical" label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <Menu trigger={more} onClose={() => setOpen(false)}>
          <MenuItem disabled={!can} title={can ? undefined : 'Needs subagents, not in this chat'} onClick={() => { setOpen(false); send({ type: 'prompt', text: `/${SPEC_REVIEW_COMMAND} ${path}` }); }}>Review with fresh eyes</MenuItem>
        </Menu>
      )}
    </span>
  );
}

function SpecBody({ d }: { d: BuildDetail }) {
  const failed = d.criteria.some((c) => c.result === 'fail');
  return (
    <>
      <Section label="Flow" />
      <div className="ui-group">
        {d.flow.map((f) => {
          const badge = flowBadge(f);
          return <Row key={f.key} plain leading={<FlowMark state={f.state} />} title={FLOW_LABEL[f.key]} meta={[f.by, f.result, f.at && ago(f.at)].filter(Boolean).join(' · ')} state={badge && <Badge {...badge} />} />;
        })}
      </div>
      {d.criteria.length > 0 && (
        <>
          <Section label="Acceptance criteria" action={testCounts(d.criteria).map((c) => <Badge key={c.status} {...c} />)} />
          <div className="ui-group">
            <Capped items={d.criteria} limit={failed ? d.criteria.length : FOLD} render={(c) => {
              const badge = criterionBadge(c);
              return <Row key={c.n} plain className="bd-clamp" title={c.text} meta={`${c.ui ? 'UI · ' : ''}${c.evidence || 'Not tested'}`} state={badge && <Badge {...badge} />} />;
            }} />
          </div>
        </>
      )}
      <Findings target={`spec:${d.slug}`} />
    </>
  );
}

const MARK_TONE: Record<string, string> = { done: 'ok', failed: 'err', waiting: 'warn' };

function FlowMark({ state }: { state: BuildDetail['flow'][number]['state'] }) {
  return (
    <span className="bd-flow">
      {state === 'running' ? <span className="dot running" /> : <span className={`bd-flow-mark ${MARK_TONE[state] ?? 'hollow'}`} />}
    </span>
  );
}

// A spec write that no longer holds the live card, shown plain.
export function SpecRow({ slug, meta }: { slug: string; meta: string }) {
  return (
    <div className="ui-group tr-act">
      <Row plain leading={<Icon name="beaker" />} title={slug} meta={meta} />
    </div>
  );
}
