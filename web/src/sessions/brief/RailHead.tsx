import { useState } from 'react';
import { send, useStore } from '../../app/store';
import { IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { TriesBoard } from '../TriesBoard';
import { ReviewCard } from '../ReviewCard';
import { stopRun } from '../openChat';
import { OUTCOME_DOT, loopNow, nowMeta, runLine } from '../runLogic';
import { agentsOf } from '../agents';
import { useChatRun } from '../useChatRun';
import { useCan } from '../../chat/useCan';
import { runCost } from '../../../../shared/cost';
import { APPROVE } from '../../../../shared/build';

// The rail's title with the run's controls, and the run's state under it. With `onBack` (an agent is open), a back arrow leads the title.
export function RailHead({ titled = true, onClose, onBack }: { titled?: boolean; onClose?: () => void; onBack?: () => void }) {
  const chat = useStore((s) => s.session.id);
  const run = useChatRun(chat);
  const live = useStore((s) => s.live.find((c) => c.id === chat));
  const agents = useStore((s) => agentsOf(s.events));
  const canStop = useCan('stopTask');
  const [board, setBoard] = useState(false);
  const back = onBack && <IconButton icon="arrow-left" label="Back to agents" size="sm" onClick={onBack} />;
  if (run?.kind === 'job' && run.review === 'pending') return <>{back && <div className="rail-h">{back}</div>}<ReviewCard run={run} /></>;
  const running = agents.filter((a) => a.status === 'running' && !a.group);
  // Tries and jobs have Stop only; a build also pauses after its task and resumes.
  const stop = () => (run ? stopRun(run) : running.forEach((a) => send({ type: 'stop_task', toolUseId: a.id })));
  const now = run && loopNow(run, live?.now);
  const dot = live?.running || running.length > 0 ? 'running' : OUTCOME_DOT[run?.rounds.at(-1)?.outcome ?? 'quiet'];
  return (
    <>
      <div className="rail-h">
        {back}
        {titled ? <span className="rail-title">Agents</span> : <span className="spacer" />}
        {run?.kind === 'tries' && <IconButton icon="layout" label="Open board" size="sm" onClick={() => setBoard(true)} />}
        {run?.kind === 'build' && (run.state === 'paused'
          ? <IconButton icon="debug-continue" label={run.why === APPROVE ? 'Build all' : 'Resume'} size="sm" onClick={() => send({ type: 'run', run: run.id, op: 'resume' })} />
          : !run.pausing && <IconButton icon="debug-pause" label="Pause after this task" size="sm" onClick={() => send({ type: 'run', run: run.id, op: 'pause' })} />)}
        {(run || (canStop && running.length > 0)) && <IconButton icon="debug-stop" label={run ? 'Stop the run' : 'Stop all agents'} size="sm" onClick={stop} />}
        {onClose && <IconButton icon="close" label="Close the agents" size="sm" onClick={onClose} />}
      </div>
      {run && <div className="rail-s">{runLine(run)}</div>}
      {run && now && (
        <div className="rail-run">
          <Row lines={2} leading={<span className={`dot ${dot}`} />} title={now.title} meta={nowMeta(now) || undefined} plain />
          <Row lines={1} title={run.what} trailing={runCost(run)} plain />
        </div>
      )}
      {board && <TriesBoard runId={run!.id} onClose={() => setBoard(false)} />}
    </>
  );
}
