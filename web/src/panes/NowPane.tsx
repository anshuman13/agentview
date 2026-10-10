import { useMemo } from 'react';
import { send, useStore } from '../store';
import { Summary } from './Summary';

export function NowPane() {
  const status = useStore((s) => s.status);
  const session = useStore((s) => s.session);
  const events = useStore((s) => s.events);
  const lastTool = useMemo(() => [...events].reverse().find((e) => e.kind === 'tool_use'), [events]);

  return (
    <div className="now-pane">
      <div className="section-title">Status</div>
      <div className="status-row">
        <span className={`dot ${session.running ? 'running' : ''}`} />
        <span className="status-text">{status}</span>
        {session.running && (
          <button className="ghost stop" onClick={() => send({ type: 'interrupt' })}>Stop</button>
        )}
      </div>
      {session.running && lastTool && lastTool.kind === 'tool_use' && (
        <div className="status-tool" title={lastTool.summary}>{lastTool.summary}</div>
      )}

      <Summary />
    </div>
  );
}
