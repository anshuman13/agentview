import { useState } from 'react';
import { send, useStore } from '../../app/store';
import { IconButton, ShowAll } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { money } from '../../ui/util';
import { TriesBoard } from '../TriesBoard';
import { ReviewCard } from '../ReviewCard';
import { RoundRow } from '../RoundRow';
import { capLine, openGoal, runControl, showTurn } from '../goalLogic';
import { loopNow, runLine } from '../runLogic';
import { agentsOf } from '../agents';
import { useChatRun } from '../useChatRun';
import { useCan } from '../../chat/useCan';
import type { RunOp } from '../../../../shared/protocol';
import { billing } from '../../../../shared/providers';
import { mergeQuiet, rounds, roundsSummary, runDetail } from '../../../../shared/goalText';

// The rail's title with the run's controls, and the run's state under it.
export function RailHead({ titled = true, onClose }: { titled?: boolean; onClose?: () => void }) {
  const chat = useStore((s) => s.session.id);
  const run = useChatRun(chat);
  const live = useStore((s) => s.live.find((c) => c.id === chat));
  const agents = useStore((s) => agentsOf(s.events));
  const canStop = useCan('stopTask');
  const [board, setBoard] = useState(false);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (run?.kind === 'job' && run.review === 'pending') return <ReviewCard run={run} />;
  const running = agents.filter((a) => a.status === 'running' && !a.group);
  const control = (op: RunOp) => run && runControl(run, op, Boolean(live?.running));
  const paused = run?.state === 'paused';
  // Tries and jobs have no pause of their own: Stop is their only control.
  const pausable = run && run.kind !== 'tries' && run.kind !== 'job';
  const stop = () => (run ? control('stop') : running.forEach((a) => send({ type: 'stop_task', toolUseId: a.id })));
  const next = run && loopNow(run, live?.now).next;
  const line = run && [runLine(run), next && `next ${next}`].filter(Boolean).join(' · ');
  const cap = run && capLine(run);
  const groups = run && (run.kind === 'goal' || run.kind === 'loop') ? mergeQuiet(run.rounds).reverse() : [];
  const roundsMeta = run && [roundsSummary(run.rounds), money(run.rounds.reduce((sum, r) => sum + r.costUsd, 0), billing(run.provider))].join(' · ');
  return (
    <>
      <div className="rail-h">
        {titled ? <span className="rail-title">Agents</span> : <span className="spacer" />}
        {run?.kind === 'tries' && <IconButton icon="layout" label="Open board" size="sm" onClick={() => setBoard(true)} />}
        {pausable && <IconButton icon={paused ? 'debug-start' : 'debug-pause'} label={paused ? 'Resume' : 'Pause'} size="sm" onClick={() => control(paused ? 'resume' : 'pause')} />}
        {(run || (canStop && running.length > 0)) && <IconButton icon="debug-stop" label={run ? 'Stop the run' : 'Stop all agents'} size="sm" onClick={stop} />}
        {onClose && <IconButton icon="close" label="Close the agents" size="sm" onClick={onClose} />}
      </div>
      {line && (runDetail(run).opens ? <button className="rail-s" onClick={() => openGoal(run.id)}>{line}</button> : <div className="rail-s">{line}</div>)}
      {(cap || groups.length > 0) && (
        <div className="rail-run">
          {cap && <Row plain lines={1} leading={<Icon name="dashboard" />} title={cap.text} state={cap.near ? <Badge status="waiting" label="Near cap" /> : undefined} />}
          {groups.length > 0 && <Row lines={1} title={rounds(run!.round)} meta={roundsMeta} trailing={<Icon name={open ? 'chevron-up' : 'chevron-down'} small />} aria-expanded={open} onClick={() => setOpen(!open)} />}
          {open && (all ? groups : groups.slice(0, 10)).map((g) => <RoundRow key={g.first.at} group={g} provider={run!.provider} open={showTurn} />)}
          {open && !all && groups.length > 10 && <ShowAll count={groups.length} className="ov-more" onClick={() => setAll(true)} />}
        </div>
      )}
      {board && <TriesBoard runId={run!.id} onClose={() => setBoard(false)} />}
    </>
  );
}
