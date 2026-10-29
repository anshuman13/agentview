import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { pressable } from '../ui/util';
import { cite } from './mcpActions';
import { brief, type Call } from './mcpHelpers';

export function CallRow({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const state = !call.result ? 'wait' : call.result.isError ? 'bad' : 'ok';
  return (
    <div className={`mcp-call ${state} ${open ? 'open' : ''}`}>
      <div className="t" {...pressable(() => setOpen((v) => !v))}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span className="mono name">{call.tool}</span>
        <span className="in" title={brief(call.input)}>{brief(call.input)}</span>
        <span className={`s ${state}`}>{state === 'wait' ? 'running' : state === 'bad' ? 'error' : 'ok'}</span>
        <button className="icon-btn mcp-insert" title="Add the result to chat" disabled={!call.result} onClick={(e) => { e.stopPropagation(); void cite(call); }}><Icon name="insert" small /></button>
      </div>
      {open && (
        <div className="r">
          <pre>{JSON.stringify(call.input, null, 2)}</pre>
          {call.result && <pre className={call.result.isError ? 'bad' : ''}>{call.result.text || '(no output)'}</pre>}
        </div>
      )}
    </div>
  );
}
