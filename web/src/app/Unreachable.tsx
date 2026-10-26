import { useEffect, useState } from 'react';
import { apiBase, bundled } from './api';
import { Icon } from '../ui/Icon';
import { useMacName } from './MacsPopover';
import { connect, useStore } from './store';

export function useUnreachable() {
  const connected = useStore((s) => s.ui.connected);
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (connected || !bundled) return;
    const t = setTimeout(() => setLate(true), 4000);
    return () => clearTimeout(t);
  }, [connected]);
  return late;
}

export function Unreachable({ onMacs }: { onMacs: () => void }) {
  const name = useMacName() || apiBase().replace(/^https?:\/\//, '');
  return (
    <div className="empty-state">
      <Icon name="plug" />
      <div className="empty-title">Can't reach {name}</div>
      <div className="muted small">NetBird must be connected and AgentView running on that Mac.</div>
      <div className="unreachable-actions">
        <button className="btn" onClick={connect}>Retry</button>
        <button className="btn" onClick={onMacs}>Choose a Mac</button>
      </div>
    </div>
  );
}
