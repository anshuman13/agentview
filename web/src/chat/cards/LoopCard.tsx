import { useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { clock } from '../../../../shared/util';
import { IconButton, ShowAll } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { TriesBoard } from '../../sessions/TriesBoard';
import { capLine, openGoal, runControl, showTurn } from '../../sessions/goalLogic';
import { ReviewCard } from '../../sessions/ReviewCard';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { TranscriptBox } from '../transcript/Box';
import { money, plural, useTick } from '../../ui/util';
import { openAgent } from '../../sessions/agents';
import { usePlanProgress } from '../../sessions/usePlanProgress';
import { planOf } from '../../../../shared/goalForm';
import { billing } from '../../../../shared/providers';
import { buildsLine, mergeQuiet, rounds, roundsSummary, runDetail } from '../../../../shared/goalText';
import type { RunOp } from '../../../../shared/protocol';
import { useCardOpen } from './useCardOpen';
import { useChatRun } from '../../sessions/useChatRun';
import { RoundRow } from '../../sessions/RoundRow';
import { OUTCOME_DOT, agentAge, loopNow, loopOpenByDefault, runLine, sendsAt } from '../../sessions/runLogic';

export function LoopCard() {
  const chat = useStore((s) => s.session.id);
  const run = useChatRun(chat);
  const live = useStore((s) => s.live.find((c) => c.id === chat));
  const plan = run?.kind === 'goal' ? planOf(run.what) : null;
  const { progress } = usePlanProgress(plan, run?.chatId);
  const agents = live?.agentList ?? [];
  const now = useTick(30_000, agents.length > 0);
  const waiting = useStore((s) => s.pending.length > 0);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const [board, setBoard] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const phone = useCardOpen(`${chat}:loop`, waiting || Boolean(run?.needsYou));
  if (!run) return null;
  if (run.kind === 'job' && run.review === 'pending') return <ReviewCard run={run} />;
  const control = (op: RunOp) => runControl(run, op, Boolean(live?.running));
  const scheduled = sendsAt(run) !== null;
  // Tries and jobs have no pause or rounds of their own to run now: Stop is their only control.
  const stopOnly = run.kind === 'tries' || run.kind === 'job';
  const goal = run.kind === 'goal';
  const rounded = goal || run.kind === 'loop';
  const paused = run.state === 'paused';
  const report = run.rounds.filter((r) => r.report).at(-1);
  const state = loopNow(run, live?.now);
  const working = Boolean(live?.running) || agents.length > 0;
  const stop = () => control('stop');
  const details = runDetail(run).opens ? () => openGoal(run.id) : undefined;
  const meta = [state.at && clock(state.at), state.next && `Next: ${state.next}`, state.stepsLeft && `${state.stepsLeft} ${state.stepsLeft === 1 ? 'step' : 'steps'} left`, buildsLine(run)].filter(Boolean).join(' · ');
  const nowClick = details ? { onClick: details } : { plain: true };
  const cap = capLine(run);
  const groups = mergeQuiet(run.rounds).reverse();
  const roundsMeta = [roundsSummary(run.rounds), money(run.rounds.reduce((sum, r) => sum + r.costUsd, 0), billing(run.provider))].join(' · ');
  const dot = working ? 'running' : OUTCOME_DOT[run.rounds.at(-1)?.outcome ?? 'quiet'];
  return (
    <>
    <TranscriptBox
      key={run.id}
      id={`loop:${run.id}`}
      className="lc"
      defaultOpen={!phone && loopOpenByDefault(run, working, waiting)}
      open={phone?.open}
      onToggle={phone?.toggle}
      title={runLine(run)}
      action={(
        <>
          {scheduled && <IconButton icon="close" label="Cancel" size="sm" onClick={stop} />}
          {run.kind === 'tries' && <IconButton icon="layout" label="Open board" size="sm" onClick={() => setBoard(true)} />}
          {!stopOnly && !scheduled && <IconButton icon={paused ? 'debug-start' : 'debug-pause'} label={paused ? 'Resume' : 'Pause'} size="sm" onClick={() => control(paused ? 'resume' : 'pause')} />}
          {!scheduled && (stopOnly
            ? <IconButton icon="debug-stop" label="Stop" size="sm" onClick={stop} />
            : (
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
            ))}
        </>
      )}
    >
    <div className="lc-body">
      <Row lines={2} leading={<span className={`dot ${dot}`} />} title={state.title} meta={meta || undefined} {...nowClick} />
      {agents.length === 1 && <Row leading={<Icon name="hubot" />} title={agents[0].slug ?? agents[0].description} meta={`${agents[0].type} · ${agentAge(agents[0].startedAt, now)}`} state="" onClick={() => openAgent(agents[0].id)} />}
      {agents.length > 1 && <Row leading={<Icon name="hubot" />} title={plural(agents.length, 'agent')} meta={agents.map((a) => a.slug ?? a.description).join(', ')} state="" onClick={() => openAgent()} />}
      {goal ? <button className="lc-line lc-last" onClick={details}><span className="lc-what">{progress ? `Plan ${progress}` : run.what}</span></button>
        : details ? <button className="lc-line lc-last" onClick={details}><span className="lc-what">{run.what}</span><span className="lc-cost">{money(run.costUsd, billing(run.provider))}</span></button>
          : <Row plain lines={1} title={run.what} trailing={money(run.costUsd, billing(run.provider))} />}
      {cap && <Row plain lines={1} leading={<Icon name="dashboard" />} title={cap.text} state={cap.near ? <Badge status="waiting" label="Near cap" /> : undefined} />}
      {rounded && groups.length > 0 && <Row lines={1} title={rounds(run.round)} meta={roundsMeta} trailing={<Icon name={open ? 'chevron-up' : 'chevron-down'} small />} aria-expanded={open} onClick={() => setOpen(!open)} />}
      {open && rounded && (
        <div className="lc-rounds">
          {(all ? groups : groups.slice(0, 10)).map((g) => <RoundRow key={g.first.at} group={g} provider={run.provider} open={showTurn} />)}
          {!all && groups.length > 10 && <ShowAll count={groups.length} className="ov-more" onClick={() => setAll(true)} />}
        </div>
      )}
      {report && <button className="lc-line lc-last" onClick={() => showTurn(report.report!)}><span className="lc-time">{clock(report.at)}</span><span className="lc-what">Weekly report</span></button>}
    </div>
    </TranscriptBox>
    {board && <TriesBoard runId={run.id} onClose={() => setBoard(false)} />}
    </>
  );
}
