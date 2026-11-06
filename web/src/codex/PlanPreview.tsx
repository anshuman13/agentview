import { useRef, useState } from 'react';
import { rowKey } from './data/sync';
import { useAssistantStore } from './data';
import { errorText } from './data/engine';
import { focusTitle } from './data/plan';
import { clock } from './time';
import { showSnack } from './view';
import { Button, IconButton } from '../ui/Button';
import { createPlanned, type Planned } from './planFlow';

// The state of a plan preview: pack(keep) gives the plan for all tasks, or only those in keep; Create blocks time for each task.
export function usePlanFlow(pack: (keep?: Set<string>) => Planned[]) {
  const store = useAssistantStore();
  const [plan, setPlan] = useState<Planned[] | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const start = () => setPlan(pack());
  const leaveOut = (p: Planned) => setPlan(pack(new Set((plan ?? []).filter((x) => x !== p).map((x) => rowKey(x.task)))));
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
      setPlan(res.left);
    }
    busy.current = false;
    setSaving(false);
  };
  return { plan, setPlan, saving, start, leaveOut, create };
}

export function PlanPreview({ flow, day }: { flow: ReturnType<typeof usePlanFlow>; day: string }) {
  const { plan, saving } = flow;
  if (!plan) return null;
  return (
    <div className="ov-card dp-block">
      {plan.length ? plan.map((p) => (
        <div key={rowKey(p.task)} className="dp-when">
          <span className="muted small">{clock(p.span[0])}-{clock(p.span[1])}</span>
          <span className="ov-t">{p.task.title}</span>
          <span className="spacer" />
          <IconButton icon="close" size="sm" small label={`Leave out ${p.task.title}`} title="Leave out" onClick={() => flow.leaveOut(p)} />
        </div>
      )) : <span className="as-ctx">No task fits in {day}'s free time</span>}
      <div className="dp-when">
        <span className="muted small">{plan.length ? 'Creates one "Focus:" event per task, no attendees' : ''}</span>
        <span className="spacer" />
        <Button size="sm" onClick={() => flow.setPlan(null)}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={saving || !plan.length} onClick={() => void flow.create()}>{saving ? 'Creating' : 'Create'}</Button>
      </div>
    </div>
  );
}
