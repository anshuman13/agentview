import { useRef, useState } from 'react';
import { Menu } from '../../ui/Menu';
import { Icon } from '../../ui/Icon';
import { headerState } from '../runLogic';
import type { LiveChat } from '../../../../shared/protocol';
import { doingLabel, type ToolUse } from '../../chat/transcript/steps';
import { time } from './time';

type Props = {
  state: 'waiting' | 'stopping' | 'running' | 'idle';
  status: string;
  chat: LiveChat | undefined;
  pending: number;
  lastReply: { at: number } | undefined;
  lastTool: ToolUse | undefined;
  done: { id: string; text: string }[];
  next: string[];
  cwd: string;
};

function StepList({ done, next }: { done: Props['done']; next: string[] }) {
  return (
    <ul className="steps">
      {done.map((d) => <li key={d.id} className="step done" title={d.text}><Icon name="check" small /><span className="text">{d.text}</span></li>)}
      {next.map((t, i) => <li key={`${i}:${t}`} className="step" title={t}><span className="text">{t}</span></li>)}
    </ul>
  );
}

// What the server sets when a turn starts on its own; it names the cause, not the work.
const WAKE = /^(Claude continued after a background task|Codex started a turn for your message|Woke up for a scheduled or background task)$/;

// The status bar's headerState, plus Stopping, which only the open chat knows. A running turn whose status only says why it woke shows its current task or step.
function nowText({ state, status, chat, pending, next }: Pick<Props, 'state' | 'status' | 'chat' | 'pending' | 'next'>, step: string) {
  if (state === 'stopping') return 'Stopping…';
  const vague = state === 'running' && WAKE.test(status);
  if (vague) return next[0] || step || 'Working';
  return headerState({ pending, failed: chat?.failed, stalled: chat?.stalled, running: state === 'running', status, agentList: chat?.agentList, run: chat?.run }).text;
}

const markIcon = (state: Props['state']) => <Icon name={state === 'waiting' ? 'bell-dot' : state === 'idle' ? 'circle-large-outline' : 'loading'} small spin={state === 'running' || state === 'stopping'} />;

// The chat's state at the right of its header, with the time of the last reply while idle; a click opens what it is doing: the tool running, the steps done this turn (checked) and the next steps.
export function HeadState(p: Props) {
  const { state, lastReply, lastTool, done, next, cwd } = p;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const step = state === 'running' && lastTool?.kind === 'tool_use' && !lastTool.name.endsWith('__set_status') ? doingLabel(lastTool, cwd) : '';
  const text = nowText(p, step);
  const count = done.length + next.length;
  return (
    <span className="tl-more">
      <button ref={btn} className={`tl-state ${state}`} title={text} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {markIcon(state)}
        <span className="text">{text}</span>
        {state === 'idle' && lastReply && <span className="when" title={new Date(lastReply.at).toLocaleString()}>{time(lastReply.at)}</span>}
        {count > 0 && <span className="count">{done.length}/{count}</span>}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
      </button>
      {open && (
        <Menu trigger={btn} onClose={() => setOpen(false)} className="tl-pop">
          <div className={`tl-now ${state}`}>
            <span className="mark">{markIcon(state)}</span>
            <span className="text" title={text}>
              {text}
              {step && step !== text && <span className="tool" title={step}>{step}</span>}
            </span>
          </div>
          <StepList done={done} next={next} />
        </Menu>
      )}
    </span>
  );
}
