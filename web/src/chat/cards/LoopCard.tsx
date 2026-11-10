import { useRef, useState } from 'react';
import { send, useStore } from '../../app/store';
import { showSnack } from '../../codex/view';
import { clock } from '../../codex/tasks/time';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { Panel } from '../../ui/Panel';
import { TriesBoard } from '../../sessions/TriesBoard';
import { openGoal } from '../../sessions/goalLogic';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { money, plural, useTick } from '../../ui/util';
import { openAgent } from '../../sessions/agents';
import { usePlanProgress } from '../../sessions/usePlanProgress';
import { planOf } from '../../../../shared/goalForm';
import { billing } from '../../../../shared/providers';
import type { RunOp } from '../../../../shared/protocol';
import { OUTCOME_DOT, agentAge, loopNow, runLine, showTurn, stoppedText } from '../composer/composerLogic';

const MAX_AGENTS = 3;

const word = (text: string) => text[0].toUpperCase() + text.slice(1);

export function LoopCard() {
  const chat = useStore((s) => s.session.id);
  const run = useStore((s) => s.runs.filter((r) => r.chatId === chat && r.state !== 'done').at(-1));
  const live = useStore((s) => s.live.find((c) => c.id === chat));
  const phase = useStore((s) => s.session.loop.phase);
  const plan = run?.kind === 'goal' ? planOf(run.what) : null;
  const { progress } = usePlanProgress(plan, run?.chatId);
  const agents = live?.agentList ?? [];
  const now = useTick(30_000, agents.length > 0);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [board, setBoard] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  if (!run) return null;
  const control = (op: RunOp) => send({ type: 'run', run: run.id, op });
  const cycle = run.kind === 'cycle' || run.kind === 'tries';
  const goal = run.kind === 'goal';
  const paused = run.state === 'paused';
  const report = run.rounds.filter((r) => r.report).at(-1);
  const state = loopNow(run, live?.now);
  const working = Boolean(live?.running) || agents.length > 0;
  const stop = () => {
    control('stop');
    showSnack(stoppedText(run), cycle ? undefined : () => control('restore'));
  };
  const details = goal ? () => openGoal(run.id) : undefined;
  const meta = [state.at && clock(state.at), state.source === 'round' && state.outcome && word(state.outcome), state.next && `Next: ${state.next}`, state.stepsLeft && `${state.stepsLeft} ${state.stepsLeft === 1 ? 'step' : 'steps'} left`].filter(Boolean).join(' · ');
  const nowClick = details ? { onClick: details } : run.kind === 'loop' && state.source === 'round' ? { onClick: () => setOpen(!open), 'aria-expanded': open } : { plain: true };
  const dot = working ? 'running' : OUTCOME_DOT[run.rounds.at(-1)?.outcome ?? 'quiet'];
  return (
    <Panel padding="sm" className="lc">
      <div className="lc-head">
        {goal
          ? <button className="lc-state lc-link" onClick={details}>{runLine(run, phase)}</button>
          : <span className="lc-state">{runLine(run, phase)}</span>}
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
                  <MenuItem danger onClick={() => { setMenu(false); stop(); }}>Stop</MenuItem>
                </Menu>
              )}
            </>
          )}
      </div>
      <Row lines={2} leading={<span className={`dot ${dot}`} />} title={state.title} meta={meta || undefined} {...nowClick} />
      {agents.slice(0, MAX_AGENTS).map((a) => <Row key={a.id} leading={<Icon name="hubot" />} title={a.slug ?? a.description} meta={`${a.type} · ${agentAge(a.startedAt, now)}`} state="" onClick={() => openAgent(a.id)} />)}
      {agents.length > MAX_AGENTS && <Row leading={<Icon name="hubot" />} title={plural(agents.length - MAX_AGENTS, 'more agent')} onClick={() => openAgent()} />}
      <div className="lc-line" onClick={details}><span className="lc-what">{progress ? `Plan ${progress}` : run.what}</span><span className="lc-cost">{money(run.costUsd, billing(run.provider))}</span></div>
      {report && <button className="lc-line lc-last" onClick={() => showTurn(report.report!)}><span className="lc-time">{clock(report.at)}</span><span className="lc-what">Weekly report</span></button>}
      {open && run.kind === 'loop' && (
        <ul className="lc-rounds">
          {run.rounds.slice(-10).reverse().map((r) => (
            <li key={r.at} className="lc-line">
              <span className="lc-time">{clock(r.at)}</span>
              <span className={`dot ${OUTCOME_DOT[r.outcome]}`} />
              <span className="lc-what">{r.line || r.outcome}</span>
              <span className="lc-cost">{money(r.costUsd, billing(run.provider))}</span>
            </li>
          ))}
        </ul>
      )}
      {board && <TriesBoard runId={run.id} onClose={() => setBoard(false)} />}
    </Panel>
  );
}
