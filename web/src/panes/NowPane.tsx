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
      <div className={`status-card ${session.running ? 'running' : ''}`}>
        <div className="section-title">Status</div>
        <div className="status-text">{status}</div>
        {session.running && lastTool && lastTool.kind === 'tool_use' && (
          <div className="muted mono">{lastTool.summary}</div>
        )}
        {session.running && (
          <button className="ghost" onClick={() => send({ type: 'interrupt' })}>Stop</button>
        )}
      </div>

      <Summary />
    </div>
  );
}
