import { useRef, useState } from 'react';
import { Menu } from '../../ui/Menu';
import { Icon } from '../../ui/Icon';
import { headerState } from '../runLogic';
import type { LiveChat } from '../../../../shared/protocol';
import type { ToolUse } from '../../chat/transcript/steps';
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
};

function StepList({ done, next }: { done: Props['done']; next: string[] }) {
  return (
    <ul className="steps">
      {done.map((d) => <li key={d.id} className="step done"><Icon name="check" small /><span className="text">{d.text}</span></li>)}
      {next.map((t, i) => <li key={`${i}:${t}`} className="step"><span className="text">{t}</span></li>)}
    </ul>
  );
}

// The status bar's headerState, plus Stopping, which only the open chat knows.
function nowText({ state, status, chat, pending }: Pick<Props, 'state' | 'status' | 'chat' | 'pending'>) {
  if (state === 'stopping') return 'Stopping…';
  return headerState({ pending, failed: chat?.failed, stalled: chat?.stalled, running: state === 'running', status, agentList: chat?.agentList, run: chat?.run }).text;
}

const markIcon = (state: Props['state']) => <Icon name={state === 'waiting' ? 'bell-dot' : state === 'idle' ? 'circle-large-outline' : 'loading'} small spin={state === 'running' || state === 'stopping'} />;

// The chat's state at the right of its header, with the time of the last reply while idle; a click opens what it is doing: the tool running, the steps done this turn (checked) and the next steps.
export function HeadState(p: Props) {
  const { state, lastReply, lastTool, done, next } = p;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const text = nowText(p);
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
            <span className="text">
              {text}
              {state === 'running' && lastTool?.kind === 'tool_use' && <span className="tool">{lastTool.summary}</span>}
            </span>
          </div>
          <StepList done={done} next={next} />
        </Menu>
      )}
    </span>
  );
}
