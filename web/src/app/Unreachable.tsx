import { useEffect, useState } from 'react';
import { apiBase, bundled } from './api';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { useMacName } from './macName';
import { retryNow, useStore } from './store';

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

export function Unreachable() {
  const name = useMacName() || apiBase().replace(/^https?:\/\//, '');
  return (
    <EmptyState size="md" icon="plug" title={`Can't reach ${name}`} hint="NetBird must be connected and AgentView running on that Mac" action={<Button size="sm" onClick={retryNow}>Retry</Button>} />
  );
}
