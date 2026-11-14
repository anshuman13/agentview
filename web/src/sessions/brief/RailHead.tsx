import { useState } from 'react';
import { send, useStore } from '../../app/store';
import { IconButton } from '../../ui/Button';
import { TriesBoard } from '../TriesBoard';
import { ReviewCard } from '../ReviewCard';
import { openGoal, runControl } from '../goalLogic';
import { loopNow, runLine } from '../runLogic';
import { agentsOf } from '../agents';
import { useChatRun } from '../useChatRun';
import { useCan } from '../../chat/useCan';
import type { RunOp } from '../../../../shared/protocol';

// The rail's title with the run's controls, and the run's state under it.
export function RailHead() {
  const chat = useStore((s) => s.session.id);
  const run = useChatRun(chat);
  const live = useStore((s) => s.live.find((c) => c.id === chat));
  const phase = useStore((s) => s.session.loop.phase);
  const agents = useStore((s) => agentsOf(s.events));
  const canStop = useCan('stopTask');
  const [board, setBoard] = useState(false);
  if (run?.kind === 'job' && run.review === 'pending') return <ReviewCard run={run} />;
  const running = agents.filter((a) => a.status === 'running' && !a.group);
  const control = (op: RunOp) => run && runControl(run, op, Boolean(live?.running));
  const paused = run?.state === 'paused';
  // Cycles, tries and jobs have no pause of their own: Stop is their only control.
  const pausable = run && run.kind !== 'cycle' && run.kind !== 'tries' && run.kind !== 'job';
  const stop = () => (run ? control('stop') : running.forEach((a) => send({ type: 'stop_task', toolUseId: a.id })));
  const next = run && loopNow(run, live?.now).next;
  const line = run && [runLine(run, phase), next && `next ${next}`].filter(Boolean).join(' · ');
  return (
    <>
      <div className="rail-h">
        <span className="rail-title">Agents</span>
        {run?.kind === 'tries' && <IconButton icon="layout" label="Open board" size="sm" onClick={() => setBoard(true)} />}
        {pausable && <IconButton icon={paused ? 'debug-start' : 'debug-pause'} label={paused ? 'Resume' : 'Pause'} size="sm" onClick={() => control(paused ? 'resume' : 'pause')} />}
        {(run || (canStop && running.length > 0)) && <IconButton icon="debug-stop" label={run ? 'Stop the run' : 'Stop all agents'} size="sm" onClick={stop} />}
      </div>
      {line && (run.kind === 'goal' ? <button className="rail-s" onClick={() => openGoal(run.id)}>{line}</button> : <div className="rail-s">{line}</div>)}
      {board && <TriesBoard runId={run!.id} onClose={() => setBoard(false)} />}
    </>
  );
}
