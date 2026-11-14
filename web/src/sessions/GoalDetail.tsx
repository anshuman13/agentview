import { useRef, useState, type ReactNode } from 'react';
import { send, useStore } from '../app/store';
import { clock } from '../../../shared/util';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { money } from '../ui/util';
import { billing } from '../../../shared/providers';
import type { RunEdit, RunOp } from '../../../shared/protocol';
import { planOf } from '../../../shared/goalForm';
import { span } from '../../../shared/util';
import { finishedLine, mergeQuiet } from '../../../shared/goalText';
import { BUILDS, CAPS, EVERY, STOPS, goalBadge, openRun, runControl, stopAtMs, usageLine } from './goalLogic';
import { since } from './folders';
import { usePlanProgress } from './usePlanProgress';
import { RoundRow } from './RoundRow';

function EditRow({ title, value, options, onEdit }: { title: string; value: ReactNode; options?: { label: string; edit: RunEdit }[]; onEdit: (e: RunEdit) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  if (!options) return <Row plain title={title} trailing={value} />;
  return (
    <div className="ui-row-wrap" ref={box}>
      <Row title={title} trailing={value} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <Menu trigger={box} onClose={() => setOpen(false)}>
          {options.map((o) => <MenuItem key={o.label} onClick={() => { setOpen(false); onEdit(o.edit); }}>{o.label}</MenuItem>)}
        </Menu>
      )}
    </div>
  );
}

export function GoalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const run = useStore((s) => s.runs.find((r) => r.id === id));
  const running = useStore((s) => s.live.find((c) => c.id === run?.chatId)?.running);
  const plan = run ? planOf(run.what) : null;
  const { progress } = usePlanProgress(plan, run?.chatId);
  if (!run) return null;
  const ended = run.state === 'done';
  const paused = run.state === 'paused';
  const control = (op: RunOp) => runControl(run, op, Boolean(running));
  const edit = (e: RunEdit) => send({ type: 'run_edit', run: run.id, ...e });
  const stop = () => control('stop');
  const open = (report?: string) => {
    openRun(run, report);
    onClose();
  };
  const next = paused ? `Paused · ${run.why}` : run.nextAt ? clock(run.nextAt) : 'When the agent goes idle';
  const endedLine = ended ? finishedLine(run, since) : null;
  return (
    <Sheet label={run.title} onClose={onClose} className="gl-sheet">
      <Section label="Goal" action={<Badge {...goalBadge(run)} />} />
      <div className="ui-group">
        <Row plain lines={2} title={run.what} meta="Condition" />
        {plan && <Row plain title="Plan" trailing={progress ?? ''} />}
        {endedLine ? <Row plain title="Ended" trailing={endedLine} /> : !ended && <Row plain title="Next round" trailing={next} />}
        <Row plain title="Cost" trailing={money(run.costUsd, billing(run.provider))} />
      </div>
      <Section label="Settings" />
      <div className="ui-group">
        <EditRow title="How often" value={run.every ? `Every ${span(run.every)}` : 'Until done'} options={run.every && !ended ? EVERY.filter((e) => e.ms).map((e) => ({ label: e.label, edit: { every: e.ms } })) : undefined} onEdit={edit} />
        <EditRow title="Stop at" value={run.endAt ? clock(run.endAt) : 'None'} options={ended ? undefined : STOPS.map((s) => ({ label: s.label, edit: { endAt: stopAtMs(s, Date.now()) } }))} onEdit={edit} />
        {(billing(run.provider) !== 'none' || run.maxBuilds) && <EditRow title="Usage" value={usageLine(run)} options={ended || billing(run.provider) === 'none' ? undefined : CAPS.map((c) => ({ label: c.pct ? `${c.pct}% cap` : 'No cap', edit: { capPct: c.pct } }))} onEdit={edit} />}
        <EditRow title="Build limit" value={run.maxBuilds ? String(run.maxBuilds) : 'None'} options={ended ? undefined : BUILDS.map((b) => ({ label: b.label, edit: { maxBuilds: b.n } }))} onEdit={edit} />
      </div>
      <div className="gl-actions">
        {!ended && <Button onClick={() => control(paused ? 'resume' : 'pause')}>{paused ? 'Resume' : 'Pause'}</Button>}
        {!ended && <Button variant="danger" onClick={stop}>Stop</Button>}
        <Button variant="plain" onClick={() => open()}>Open chat</Button>
      </div>
      <Section label="Rounds" count={sectionCount(run.rounds.length)} />
      {run.rounds.length ? (
        <div className="ui-group">
          {mergeQuiet(run.rounds).reverse().map((g) => <RoundRow key={g.first.at} group={g} provider={run.provider} open={open} />)}
        </div>
      ) : <EmptyState size="sm" icon="history" title="No rounds yet" hint="The first round runs when the agent goes idle" />}
    </Sheet>
  );
}
