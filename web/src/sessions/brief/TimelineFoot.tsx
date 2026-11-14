import { useState, type RefObject } from 'react';
import { send } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { touch } from '../../app/touch/touch';
import { loopLabel } from '../../chat/composer/composerLogic';
import type { ToolUse } from '../../chat/transcript/steps';
import { clock } from '../../../../shared/util';
import { readFlag, saveFlag } from '../../ui/util';
import { useNarrow } from '../../app/shell/useNarrow';
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
  next: string[];
  running: boolean;
  end: RefObject<HTMLDivElement | null>;
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
        <button className="icon-btn" title="Remove step" onPointerDown={(e) => e.preventDefault()} onClick={() => { setEdit(false); onDrop(); }}><Icon name="trash" small /></button>
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

function StepList({ next, adding, setAdding }: { next: string[]; adding: boolean; setAdding: (v: boolean) => void }) {
  return (
    <ul className="steps">
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

// The chat's state at the right of its header, with the time of the last reply while idle.
export function HeadState(p: Pick<Props, 'state' | 'status' | 'loop' | 'repeat' | 'lastReply'>) {
  const { state, lastReply } = p;
  const text = nowText(p);
  return (
    <span className={`tl-state ${state}`} title={text}>
      {markIcon(state)}
      <span className="text">{text}</span>
      {state === 'idle' && lastReply && <span className="when" title={new Date(lastReply.at).toLocaleString()}>{time(lastReply.at)}</span>}
    </span>
  );
}

export function TimelineFoot(p: Props) {
  const { state, repeat, lastTool, limit, next, running, end } = p;
  const [adding, setAdding] = useState(false);
  const narrow = useNarrow();
  const [stepsOpen, setStepsOpen] = useState(() => readFlag('agentview.steps', !touch() && !narrow));
  const toggleSteps = () => { setStepsOpen(!stepsOpen); saveFlag('agentview.steps', !stepsOpen); };
  const hasSteps = next.length > 0 || adding || running;
  const retry = state === 'idle' && !repeat && limit;
  if (state === 'idle' && !retry && !hasSteps) return <div ref={end} />;
  return (
    <div className="tl-foot">
      <div className={`tl-now ${state}`}>
        <span className="mark">{markIcon(state)}</span>
        <span className="text">
          {nowText(p)}
          {state === 'running' && lastTool?.kind === 'tool_use' && <span className="tool">{lastTool.summary}</span>}
        </span>
        <span className="side">
          {retry && <button className="link" title="Send the last prompt again when the limit resets" onClick={() => send({ type: 'prompt', text: `/loop at ${limit.at} ${limit.prompt}` })}>Continue at {limit.at}</button>}
          {hasSteps && (
            <button className="steps-toggle" aria-expanded={stepsOpen} title={stepsOpen ? 'Hide the next steps' : 'Show the next steps'} onClick={toggleSteps}>
              {next.length ? `${next.length} step${next.length === 1 ? '' : 's'}` : 'Steps'}<Icon name={stepsOpen ? 'chevron-up' : 'chevron-down'} small />
            </button>
          )}
        </span>
      </div>
      {hasSteps && stepsOpen && <StepList next={next} adding={adding} setAdding={setAdding} />}
      <div ref={end} />
    </div>
  );
}
