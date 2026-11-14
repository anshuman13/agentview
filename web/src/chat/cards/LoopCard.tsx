import { useRef, useState } from 'react';
import { send, useStore } from '../../app/store';
import { showSnack } from '../../codex/view';
import { clock } from '../../codex/tasks/time';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { TriesBoard } from '../../sessions/TriesBoard';
import { openGoal } from '../../sessions/goalLogic';
import { ReviewCard } from '../../sessions/ReviewCard';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { TranscriptBox } from '../transcript/Box';
import { money, plural, useTick } from '../../ui/util';
import { openAgent } from '../../sessions/agents';
import { usePlanProgress } from '../../sessions/usePlanProgress';
import { planOf } from '../../../../shared/goalForm';
import { billing } from '../../../../shared/providers';
import { buildsLine, mergeQuiet, roundGroupText } from '../../../../shared/goalText';
import type { RunOp } from '../../../../shared/protocol';
import { useCardOpen } from './useCardOpen';
import { OUTCOME_DOT, agentAge, loopNow, loopOpenByDefault, runLine, showTurn, stoppedText } from '../composer/composerLogic';

export function LoopCard() {
  const chat = useStore((s) => s.session.id);
  const run = useStore((s) => s.runs.filter((r) => r.chatId === chat && r.state !== 'done').at(-1));
  const live = useStore((s) => s.live.find((c) => c.id === chat));
  const phase = useStore((s) => s.session.loop.phase);
  const plan = run?.kind === 'goal' ? planOf(run.what) : null;
  const { progress } = usePlanProgress(plan, run?.chatId);
  const agents = live?.agentList ?? [];
  const now = useTick(30_000, agents.length > 0);
  const waiting = useStore((s) => s.pending.length > 0);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [board, setBoard] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const phone = useCardOpen(`${chat}:loop`, waiting || Boolean(run?.needsYou));
  if (!run) return null;
  if (run.kind === 'job' && run.review === 'pending') return <ReviewCard run={run} />;
  const control = (op: RunOp) => send({ type: 'run', run: run.id, op });
  // Cycles, tries and jobs have no pause or rounds of their own to run now: Stop is their only control.
  const cycle = run.kind === 'cycle' || run.kind === 'tries' || run.kind === 'job';
  const goal = run.kind === 'goal';
  const paused = run.state === 'paused';
  const report = run.rounds.filter((r) => r.report).at(-1);
  const state = loopNow(run, live?.now);
  const working = Boolean(live?.running) || agents.length > 0;
  const stop = () => {
    control('stop');
    showSnack(stoppedText(run, Boolean(live?.running)), cycle ? undefined : () => control('restore'));
  };
  const details = goal ? () => openGoal(run.id) : undefined;
  const meta = [state.at && clock(state.at), state.next && `Next: ${state.next}`, state.stepsLeft && `${state.stepsLeft} ${state.stepsLeft === 1 ? 'step' : 'steps'} left`, buildsLine(run)].filter(Boolean).join(' · ');
  const nowClick = details ? { onClick: details } : run.kind === 'loop' && state.source === 'round' ? { onClick: () => setOpen(!open), 'aria-expanded': open } : { plain: true };
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
      title={runLine(run, phase)}
      action={(
        <>
          {run.kind === 'tries' && <IconButton icon="layout" label="Open board" size="sm" onClick={() => setBoard(true)} />}
          {!cycle && <IconButton icon={paused ? 'debug-start' : 'debug-pause'} label={paused ? 'Resume' : 'Pause'} size="sm" onClick={() => control(paused ? 'resume' : 'pause')} />}
          {cycle
            ? <IconButton icon="debug-stop" label="Stop" size="sm" onClick={stop} />
            : (
              <>
                <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
                {menu && (
                  <Menu trigger={more} onClose={() => setMenu(false)}>
                    {!paused && <MenuItem onClick={() => { setMenu(false); control('now'); }}>Run now</MenuItem>}
                    {!paused && <MenuSeparator />}
                    <MenuItem danger onClick={() => { setMenu(false); stop(); }}>Stop</MenuItem>
                  </Menu>
                )}
              </>
            )}
        </>
      )}
    >
    <div className="lc-body">
      <Row lines={2} leading={<span className={`dot ${dot}`} />} title={state.title} meta={meta || undefined} {...nowClick} />
      {agents.length === 1 && <Row leading={<Icon name="hubot" />} title={agents[0].slug ?? agents[0].description} meta={`${agents[0].type} · ${agentAge(agents[0].startedAt, now)}`} state="" onClick={() => openAgent(agents[0].id)} />}
      {agents.length > 1 && <Row leading={<Icon name="hubot" />} title={plural(agents.length, 'agent')} meta={agents.map((a) => a.slug ?? a.description).join(', ')} state="" onClick={() => openAgent()} />}
      {goal ? progress && <div className="lc-line" onClick={details}><span className="lc-what">Plan {progress}</span></div>
        : <div className="lc-line" onClick={details}><span className="lc-what">{run.what}</span><span className="lc-cost">{money(run.costUsd, billing(run.provider))}</span></div>}
      {report && <button className="lc-line lc-last" onClick={() => showTurn(report.report!)}><span className="lc-time">{clock(report.at)}</span><span className="lc-what">Weekly report</span></button>}
      {open && run.kind === 'loop' && (
        <ul className="lc-rounds">
          {mergeQuiet(run.rounds).slice(-10).reverse().map((g) => (
            <li key={g.first.at} className="lc-line">
              <span className={`dot ${OUTCOME_DOT[g.last.outcome]}`} />
              <span className="lc-what">{roundGroupText(g)}</span>
              <span className="lc-cost">{money(g.costUsd, billing(run.provider))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
    </TranscriptBox>
    {board && <TriesBoard runId={run.id} onClose={() => setBoard(false)} />}
    </>
  );
}
