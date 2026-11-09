import { useRef, useState } from 'react';
import { send, useStore } from '../app/store';
import { showSnack } from '../codex/view';
import { clock } from '../codex/time';
import { IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Panel } from '../ui/Panel';
import { money } from '../ui/util';
import type { RunOp } from '../../../shared/protocol';
import { OUTCOME_DOT, runLine, stoppedText } from './composerLogic';

export function LoopCard() {
  const chat = useStore((s) => s.session.id);
  const run = useStore((s) => s.runs.filter((r) => r.chatId === chat && r.state !== 'done').at(-1));
  const phase = useStore((s) => s.session.loop.phase);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  if (!run) return null;
  const control = (op: RunOp) => send({ type: 'run', run: run.id, op });
  const cycle = run.kind === 'cycle';
  const paused = run.state === 'paused';
  const last = run.rounds.at(-1);
  const stop = () => {
    control('stop');
    showSnack(stoppedText(run), cycle ? undefined : () => control('restore'));
  };
  return (
    <Panel padding="sm" className="lc">
      <div className="lc-head">
        <span className="lc-state">{runLine(run, phase)}</span>
        {!cycle && <IconButton icon={paused ? 'debug-start' : 'debug-pause'} label={paused ? 'Resume' : 'Pause'} size="sm" onClick={() => control(paused ? 'resume' : 'pause')} />}
        <IconButton icon="debug-stop" label="Stop" size="sm" onClick={stop} />
        {!cycle && !paused && (
          <>
            <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
            {menu && (
              <Menu trigger={more} onClose={() => setMenu(false)}>
                <MenuItem onClick={() => { setMenu(false); control('now'); }}>Run now</MenuItem>
              </Menu>
            )}
          </>
        )}
      </div>
      <div className="lc-line"><span className="lc-what">{run.what}</span><span className="lc-cost">{money(run.costUsd)}</span></div>
      {last && (
        <button className="lc-line lc-last" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={`dot ${OUTCOME_DOT[last.outcome]}`} />
          <span className="lc-what">{last.line || last.outcome}</span>
        </button>
      )}
      {open && (
        <ul className="lc-rounds">
          {run.rounds.slice(-10).reverse().map((r) => (
            <li key={r.n} className="lc-line">
              <span className="lc-time">{clock(r.at)}</span>
              <span className={`dot ${OUTCOME_DOT[r.outcome]}`} />
              <span className="lc-what">{r.line || r.outcome}</span>
              <span className="lc-cost">{money(r.costUsd)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
