import { useRef, useState } from 'react';
import { rowKey } from './data/sync';
import { useAssistantStore } from './data';
import { errorText } from './data/engine';
import { focusTitle } from './data/plan';
import { clock } from './time';
import { showSnack } from './view';
import { Button, IconButton } from '../ui/Button';
import { createPlanned, skippedOf, splitPlan, type Planned } from './planFlow';
import type { ItemRow } from './data/sync';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { EmptyState } from '../ui/Panel';

// The state of a plan preview: pack(keep) gives the plan for all candidates, or only those in keep; Create blocks time for each task.
// The candidates not in the plan are the skipped tasks, left out by the user or without room; tasks already created are not.
export function usePlanFlow(pack: (keep?: Set<string>) => Planned[], candidates: ItemRow[], day: 'today' | 'tomorrow') {
  const store = useAssistantStore();
  const [plan, setPlan] = useState<Planned[] | null>(null);
  const [leftOut, setLeftOut] = useState(new Set<string>());
  const [created, setCreated] = useState(new Set<string>());
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const start = () => {
    setLeftOut(new Set());
    setCreated(new Set());
    setPlan(pack());
  };
  const keys = (list: Planned[]) => new Set(list.map((x) => rowKey(x.task)));
  const leaveOut = (p: Planned) => {
    setLeftOut(new Set(leftOut).add(rowKey(p.task)));
    setPlan(pack(keys((plan ?? []).filter((x) => x !== p))));
  };
  const addBack = (r: ItemRow) => {
    const back = new Set(leftOut);
    back.delete(rowKey(r));
    setLeftOut(back);
    setPlan(pack(keys(plan ?? []).add(rowKey(r))));
  };
  const create = async () => {
    if (!plan?.length || busy.current) return;
    busy.current = true;
    setSaving(true);
    // Tasks done since the preview drop out and past time is not used; a changed plan is shown again before anything is created.
    const res = await createPlanned(plan, pack, (p) => store.blockTime(p.task, p.span[0], p.span[1], focusTitle(p.task.title)));
    if (res.kind === 'changed') {
      setPlan(res.plan);
      showSnack('The plan changed, check it and Create again');
    } else if (res.kind === 'created') {
      showSnack(`Blocked time for ${res.made} task${res.made === 1 ? '' : 's'}`);
      setPlan(null);
    } else {
      showSnack(`Blocked ${res.made} of ${plan.length}, then stopped: ${errorText(res.error)}`);
      setCreated(keys(plan.slice(0, res.made)));
      setPlan(res.left);
    }
    busy.current = false;
    setSaving(false);
  };
  const skipped = skippedOf(plan ?? [], candidates.filter((r) => !created.has(rowKey(r))), leftOut, day);
  return { plan, setPlan, saving, skipped, day, start, leaveOut, addBack, create };
}

export function PlanPreview({ flow }: { flow: ReturnType<typeof usePlanFlow> }) {
  return flow.plan ? <PlanCard flow={flow} plan={flow.plan} /> : null;
}

function PlanCard({ flow, plan }: { flow: ReturnType<typeof usePlanFlow>; plan: Planned[] }) {
  const [folded, setFolded] = useState(true);
  const { skipped, saving, day } = flow;
  const { now, later } = splitPlan(plan, Date.now(), day);
  const planned = (p: Planned) => (
    <Row key={rowKey(p.task)} plain title={p.task.title} meta={`${clock(p.span[0])}-${clock(p.span[1])}`}
      trailing={<IconButton icon="close" size="sm" label={`Leave out ${p.task.title}`} onClick={() => flow.leaveOut(p)} />} />
  );
  const group = (label: string, list: Planned[]) => list.length > 0 && (
    <>
      <Section label={label} count={list.length} />
      {list.map(planned)}
    </>
  );
  return (
    <div className="mt-rows ov-card">
      {plan.length ? <>{group('Now', now)}{group('Later', later)}</> : <EmptyState size="sm" title={`No task fits in ${day}'s free time`} />}
      {skipped.length > 0 && (
        <>
          <Section label="Skipped" count={skipped.length} open={!folded} onToggle={() => setFolded(!folded)} />
          {!folded && skipped.map((s) => (
            <Row key={rowKey(s.task)} plain title={s.task.title} meta={s.reason}
              trailing={s.reason === 'Left out' ? <IconButton icon="add" size="sm" label={`Add back ${s.task.title}`} onClick={() => flow.addBack(s.task)} /> : undefined} />
          ))}
        </>
      )}
      <div className="dp-foot">
        <span>{plan.length ? 'Creates one "Focus:" event per task, no attendees' : ''}</span>
        <span className="spacer" />
        <Button variant="gray" size="sm" onClick={() => flow.setPlan(null)}>Cancel</Button>
        <Button variant="filled" size="sm" disabled={saving || !plan.length} onClick={() => void flow.create()}>{saving ? 'Creating' : 'Create'}</Button>
      </div>
    </div>
  );
}
