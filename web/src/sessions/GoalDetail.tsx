import { useRef, useState, type ReactNode } from 'react';
import { send, useStore } from '../app/store';
import { clock } from '../codex/tasks/time';
import { showSnack } from '../codex/view';
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
import { OUTCOME_DOT, stoppedText } from '../chat/composer/composerLogic';
import { CAPS, EVERY, STOPS, goalBadge, openRun, stopAtMs, usageLine } from './goalLogic';
import { usePlanProgress } from './usePlanProgress';

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
  const plan = run ? planOf(run.what) : null;
  const progress = usePlanProgress(plan, run?.chatId);
  if (!run) return null;
  const ended = run.state === 'done';
  const paused = run.state === 'paused';
  const control = (op: RunOp) => send({ type: 'run', run: run.id, op });
  const edit = (e: RunEdit) => send({ type: 'run_edit', run: run.id, ...e });
  const stop = () => {
    control('stop');
    showSnack(stoppedText(run), () => control('restore'));
  };
  const open = (report?: string) => {
    openRun(run, report);
    onClose();
  };
  const next = paused ? `Paused · ${run.why}` : run.nextAt ? clock(run.nextAt) : 'When the agent goes idle';
  return (
    <Sheet label={run.title} onClose={onClose} className="gl-sheet">
      <Section label="Goal" action={<Badge {...goalBadge(run)} />} />
      <div className="ui-group">
        <Row plain lines={2} title={run.what} meta="Condition" />
        {plan && <Row plain title="Plan" trailing={progress ?? ''} />}
        <EditRow title="How often" value={run.every ? `Every ${span(run.every)}` : 'Until done'} options={run.every && !ended ? EVERY.filter((e) => e.ms).map((e) => ({ label: e.label, edit: { every: e.ms } })) : undefined} onEdit={edit} />
        <EditRow title="Stop at" value={run.endAt ? clock(run.endAt) : 'None'} options={ended ? undefined : STOPS.map((s) => ({ label: s.label, edit: { endAt: stopAtMs(s, Date.now()) } }))} onEdit={edit} />
        {billing(run.provider) !== 'none' && <EditRow title="Usage" value={usageLine(run)} options={ended ? undefined : CAPS.map((c) => ({ label: c.pct ? `${c.pct}% cap` : 'No cap', edit: { capPct: c.pct } }))} onEdit={edit} />}
        {!ended && <Row plain title="Next check" trailing={next} />}
        <Row plain title="Cost" trailing={money(run.costUsd, billing(run.provider))} />
      </div>
      <Section label="Rounds" count={sectionCount(run.rounds.length)} />
      {run.rounds.length ? (
        <div className="ui-group">
          {run.rounds.slice().reverse().map((r) => (
            <Row
              key={r.at}
              plain={!r.report}
              leading={<span className={`dot ${OUTCOME_DOT[r.outcome]}`} />}
              title={r.report ? 'Weekly report' : r.line || r.outcome}
              meta={`${clock(r.at)} · ${r.outcome[0].toUpperCase()}${r.outcome.slice(1)} · ${money(r.costUsd, billing(run.provider))}`}
              onClick={r.report ? () => open(r.report) : undefined}
            />
          ))}
        </div>
      ) : <EmptyState size="sm" icon="history" title="No rounds yet" hint="The first check runs when the agent goes idle" />}
      <div className="gl-actions">
        {!ended && <Button onClick={() => control(paused ? 'resume' : 'pause')}>{paused ? 'Resume' : 'Pause'}</Button>}
        {!ended && <Button variant="danger" onClick={stop}>Stop</Button>}
        <Button variant="plain" onClick={() => open()}>Open chat</Button>
      </div>
    </Sheet>
  );
}
