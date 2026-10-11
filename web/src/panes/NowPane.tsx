import { useMemo } from 'react';
import { send, useStore } from '../store';
import { Summary } from './Summary';
import { Icon } from '../Icon';

export function NowPane() {
  const status = useStore((s) => s.status);
  const session = useStore((s) => s.session);
  const events = useStore((s) => s.events);
  const lastTool = useMemo(() => [...events].reverse().find((e) => e.kind === 'tool_use'), [events]);

  return (
    <div className="now-pane">
      {session.running && (
        <>
          <div className="section-title">Working</div>
          <div className="status-row">
            <span className="dot running" />
            <span className="status-text">{status}</span>
            <button className="icon-btn" title="Stop" onClick={() => send({ type: 'interrupt' })}><Icon name="debug-stop" /></button>
          </div>
          {lastTool && lastTool.kind === 'tool_use' && <div className="status-tool" title={lastTool.summary}>{lastTool.summary}</div>}
        </>
      )}

      <Summary />
    </div>
  );
}
