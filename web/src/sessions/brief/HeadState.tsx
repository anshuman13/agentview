import { useRef, useState } from 'react';
import { Menu } from '../../ui/Menu';
import { send } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/Button';
import { loopLabel } from '../../chat/composer/composerLogic';
import type { ToolUse } from '../../chat/transcript/steps';
import { clock } from '../../../../shared/util';
import { time } from './time';

type Loop = { phase: string | null; round: number; max: number };

type Props = {
  state: 'waiting' | 'stopping' | 'running' | 'idle';
  status: string;
  loop: Loop;
  repeat: { nextAt?: number | null } | null | undefined;
  lastReply: { at: number } | undefined;
  lastTool: ToolUse | undefined;
  limit: { at: string; prompt: string } | null;
  done: { id: string; text: string }[];
  next: string[];
};

function Step({ text, editing = false, onSave, onDrop }: { text: string; editing?: boolean; onSave: (v: string) => void; onDrop: () => void }) {
  const [edit, setEdit] = useState(editing);
  const [value, setValue] = useState(text);
  if (edit) {
    const done = () => { setEdit(false); if (value.trim() !== text) onSave(value.trim()); else if (!text) onDrop(); };
    return (
      <li className="step editing">
        <input
          autoFocus
          value={value}
          placeholder="Describe the step"
          onChange={(e) => setValue(e.target.value)}
          onBlur={done}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) done();
            if (e.key === 'Escape') { setValue(text); setEdit(false); if (!text) onDrop(); }
          }}
        />
        <IconButton icon="trash" label="Remove step" size="sm" onPointerDown={(e) => e.preventDefault()} onClick={() => { setEdit(false); onDrop(); }} />
      </li>
    );
  }
  return (
    <li className="step" title="Tap to edit" onClick={() => setEdit(true)}>
      <span className="text">{text}</span>
    </li>
  );
}

const setNext = (list: string[]) => send({ type: 'plan', next: list });

function StepList({ done, next, adding, setAdding }: { done: Props['done']; next: string[]; adding: boolean; setAdding: (v: boolean) => void }) {
  return (
    <ul className="steps">
      {done.map((d) => <li key={d.id} className="step done"><Icon name="check" small /><span className="text">{d.text}</span></li>)}
      {next.map((t, i) => (
        <Step key={`${i}:${t}`} text={t} onSave={(v) => setNext(next.map((x, j) => (j === i ? v : x)).filter(Boolean))} onDrop={() => setNext(next.filter((_, j) => j !== i))} />
      ))}
      {adding ? (
        <Step text="" editing onSave={(v) => { setAdding(false); if (v) setNext([...next, v]); }} onDrop={() => setAdding(false)} />
      ) : (
        <li className="step add"><button className="link" onClick={() => setAdding(true)}><Icon name="add" small /> Add a step</button></li>
      )}
    </ul>
  );
}

function nowText({ state, status, loop, repeat }: Pick<Props, 'state' | 'status' | 'loop' | 'repeat'>) {
  if (state === 'waiting') return 'Waiting for you';
  if (state === 'stopping') return 'Stopping…';
  if (state === 'running') return loop.phase && ['plan', 'build', 'test'].includes(loop.phase) ? `${loopLabel(loop)} · ${status}` : status;
  if (repeat?.nextAt) return `Idle · next loop round ${clock(repeat.nextAt)}`;
  return 'Idle';
}

const markIcon = (state: Props['state']) => <Icon name={state === 'waiting' ? 'bell-dot' : state === 'idle' ? 'circle-large-outline' : 'loading'} small spin={state === 'running' || state === 'stopping'} />;

// The chat's state at the right of its header, with the time of the last reply while idle; a click opens what it is doing: the tool running, the steps done this turn (checked) and the next steps.
export function HeadState(p: Props) {
  const { state, lastReply, repeat, lastTool, limit, done, next } = p;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const text = nowText(p);
  const retry = state === 'idle' && !repeat && limit;
  const count = done.length + next.length;
  return (
    <span className="tl-more">
      {retry && <button className="link" title="Send the last prompt again when the limit resets" onClick={() => { setOpen(false); send({ type: 'prompt', text: `/loop at ${limit.at} ${limit.prompt}` }); }}>Continue at {limit.at}</button>}
      <button ref={btn} className={`tl-state ${state}`} title={text} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {markIcon(state)}
        <span className="text">{text}</span>
        {state === 'idle' && lastReply && <span className="when" title={new Date(lastReply.at).toLocaleString()}>{time(lastReply.at)}</span>}
        {count > 0 && <span className="count">{done.length}/{count}</span>}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
      </button>
      {open && (
        <Menu trigger={btn} onClose={() => { setOpen(false); setAdding(false); }} className="tl-pop">
          <div className={`tl-now ${state}`}>
            <span className="mark">{markIcon(state)}</span>
            <span className="text">
              {text}
              {state === 'running' && lastTool?.kind === 'tool_use' && <span className="tool">{lastTool.summary}</span>}
            </span>
          </div>
          {retry && <button className="link" title="Send the last prompt again when the limit resets" onClick={() => { setOpen(false); send({ type: 'prompt', text: `/loop at ${limit.at} ${limit.prompt}` }); }}>Continue at {limit.at}</button>}
          <StepList done={done} next={next} adding={adding} setAdding={setAdding} />
        </Menu>
      )}
    </span>
  );
}
