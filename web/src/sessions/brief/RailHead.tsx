import { useRef, useState } from 'react';
import { send, useStore } from '../../app/store';
import { IconButton, ShowAll } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Icon } from '../../ui/Icon';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Row } from '../../ui/Row';
import { money } from '../../ui/util';
import { TriesBoard } from '../TriesBoard';
import { ReviewCard } from '../ReviewCard';
import { RoundRow } from '../RoundRow';
import { capLine, openGoal, runControl, showTurn } from '../goalLogic';
import { OUTCOME_DOT, loopNow, nowMeta, runLine, sendsAt } from '../runLogic';
import { agentsOf } from '../agents';
import { useChatRun } from '../useChatRun';
import { usePlanProgress } from '../usePlanProgress';
import { useCan } from '../../chat/useCan';
import type { RunOp } from '../../../../shared/protocol';
import { billing } from '../../../../shared/providers';
import { planOf } from '../../../../shared/goalForm';
import { buildsLine, mergeQuiet, rounds, roundsSummary, runDetail } from '../../../../shared/goalText';

// The rail's title with the run's controls, and the run's state under it.
export function RailHead({ titled = true, onClose }: { titled?: boolean; onClose?: () => void }) {
  const chat = useStore((s) => s.session.id);
  const run = useChatRun(chat);
  const live = useStore((s) => s.live.find((c) => c.id === chat));
  const agents = useStore((s) => agentsOf(s.events));
  const canStop = useCan('stopTask');
  const { progress } = usePlanProgress(run?.kind === 'goal' ? planOf(run.what) : null, run?.chatId);
  const [board, setBoard] = useState(false);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  if (run?.kind === 'job' && run.review === 'pending') return <ReviewCard run={run} />;
  const running = agents.filter((a) => a.status === 'running' && !a.group);
  const control = (op: RunOp) => run && runControl(run, op, Boolean(live?.running));
  const paused = run?.state === 'paused';
  const scheduled = run && sendsAt(run) !== null;
  // Tries and jobs have no pause or rounds of their own to run now: Stop is their only control.
  const stopOnly = run && (run.kind === 'tries' || run.kind === 'job');
  const stop = () => (run ? control('stop') : running.forEach((a) => send({ type: 'stop_task', toolUseId: a.id })));
  const details = run && runDetail(run).opens ? () => openGoal(run.id) : undefined;
  const click = details ? { onClick: details } : { plain: true };
  const cap = run && capLine(run);
  const groups = run && (run.kind === 'goal' || run.kind === 'loop') ? mergeQuiet(run.rounds).reverse() : [];
  const roundsMeta = run && [roundsSummary(run.rounds), money(run.rounds.reduce((sum, r) => sum + r.costUsd, 0), billing(run.provider))].join(' · ');
  const report = run?.rounds.filter((r) => r.report).at(-1);
  const now = run && loopNow(run, live?.now);
  const dot = live?.running || running.length > 0 ? 'running' : OUTCOME_DOT[run?.rounds.at(-1)?.outcome ?? 'quiet'];
  return (
    <>
      <div className="rail-h">
        {titled ? <span className="rail-title">Agents</span> : <span className="spacer" />}
        {scheduled && <IconButton icon="close" label="Cancel" size="sm" onClick={stop} />}
        {run?.kind === 'tries' && <IconButton icon="layout" label="Open board" size="sm" onClick={() => setBoard(true)} />}
        {run && !stopOnly && !scheduled && <IconButton icon={paused ? 'debug-start' : 'debug-pause'} label={paused ? 'Resume' : 'Pause'} size="sm" onClick={() => control(paused ? 'resume' : 'pause')} />}
        {run && !stopOnly && !scheduled && (
          <>
            <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
            {menu && (
              <Menu trigger={more} onClose={() => setMenu(false)}>
                {!paused && <MenuItem icon="play" onClick={() => { setMenu(false); control('now'); }}>Run now</MenuItem>}
                {!paused && <MenuSeparator />}
                <MenuItem danger icon="debug-stop" onClick={() => { setMenu(false); stop(); }}>Stop</MenuItem>
              </Menu>
            )}
          </>
        )}
        {(stopOnly || (!run && canStop && running.length > 0)) && <IconButton icon="debug-stop" label={run ? 'Stop the run' : 'Stop all agents'} size="sm" onClick={stop} />}
        {onClose && <IconButton icon="close" label="Close the agents" size="sm" onClick={onClose} />}
      </div>
      {run && (details ? <button className="rail-s" onClick={details}>{runLine(run)}</button> : <div className="rail-s">{runLine(run)}</div>)}
      {run && now && (
        <div className="rail-run">
          <Row lines={2} leading={<span className={`dot ${dot}`} />} title={now.title} meta={nowMeta(now, buildsLine(run)) || undefined} {...click} />
          {run.kind === 'goal'
            ? <Row lines={1} title={progress ? `Plan ${progress}` : run.what} {...click} />
            : <Row lines={1} title={run.what} trailing={money(run.costUsd, billing(run.provider))} {...click} />}
          {cap && <Row plain lines={1} leading={<Icon name="dashboard" />} title={cap.text} state={cap.near ? <Badge status="waiting" label="Near cap" /> : undefined} />}
          {groups.length > 0 && <Row lines={1} title={rounds(run.round)} meta={roundsMeta} trailing={<Icon name={open ? 'chevron-up' : 'chevron-down'} small />} aria-expanded={open} onClick={() => setOpen(!open)} />}
          {open && (all ? groups : groups.slice(0, 10)).map((g) => <RoundRow key={g.first.at} group={g} provider={run.provider} open={showTurn} />)}
          {open && !all && groups.length > 10 && <ShowAll count={groups.length} className="ov-more" onClick={() => setAll(true)} />}
          {report && <RoundRow group={{ first: report, last: report, count: 1, costUsd: report.costUsd }} provider={run.provider} open={showTurn} />}
        </div>
      )}
      {board && <TriesBoard runId={run!.id} onClose={() => setBoard(false)} />}
    </>
  );
}
