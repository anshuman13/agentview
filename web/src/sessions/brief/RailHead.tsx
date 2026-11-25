import { useState } from 'react';
import { send, useStore } from '../../app/store';
import { IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { money } from '../../ui/util';
import { TriesBoard } from '../TriesBoard';
import { ReviewCard } from '../ReviewCard';
import { stopRun } from '../openChat';
import { OUTCOME_DOT, loopNow, nowMeta, runLine } from '../runLogic';
import { agentsOf } from '../agents';
import { useChatRun } from '../useChatRun';
import { useCan } from '../../chat/useCan';
import { billing } from '../../../../shared/providers';

// The rail's title with the run's controls, and the run's state under it.
export function RailHead({ titled = true, onClose }: { titled?: boolean; onClose?: () => void }) {
  const chat = useStore((s) => s.session.id);
  const run = useChatRun(chat);
  const live = useStore((s) => s.live.find((c) => c.id === chat));
  const agents = useStore((s) => agentsOf(s.events));
  const canStop = useCan('stopTask');
  const [board, setBoard] = useState(false);
  if (run?.kind === 'job' && run.review === 'pending') return <ReviewCard run={run} />;
  const running = agents.filter((a) => a.status === 'running' && !a.group);
  // Tries and jobs have no pause or rounds of their own to run now: Stop is their only control.
  const stop = () => (run ? stopRun(run) : running.forEach((a) => send({ type: 'stop_task', toolUseId: a.id })));
  const now = run && loopNow(run, live?.now);
  const dot = live?.running || running.length > 0 ? 'running' : OUTCOME_DOT[run?.rounds.at(-1)?.outcome ?? 'quiet'];
  return (
    <>
      <div className="rail-h">
        {titled ? <span className="rail-title">Agents</span> : <span className="spacer" />}
        {run?.kind === 'tries' && <IconButton icon="layout" label="Open board" size="sm" onClick={() => setBoard(true)} />}
        {(run || (canStop && running.length > 0)) && <IconButton icon="debug-stop" label={run ? 'Stop the run' : 'Stop all agents'} size="sm" onClick={stop} />}
        {onClose && <IconButton icon="close" label="Close the agents" size="sm" onClick={onClose} />}
      </div>
      {run && <div className="rail-s">{runLine(run)}</div>}
      {run && now && (
        <div className="rail-run">
          <Row lines={2} leading={<span className={`dot ${dot}`} />} title={now.title} meta={nowMeta(now) || undefined} plain />
          <Row lines={1} title={run.what} trailing={money(run.costUsd, billing(run.provider))} plain />
        </div>
      )}
      {board && <TriesBoard runId={run!.id} onClose={() => setBoard(false)} />}
    </>
  );
}
