import { useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/Button';
import { useTick } from '../../ui/util';
import { elapsed } from '../../sessions/agents';
import { stopTask } from '../chatActions';

const NONE: never[] = [];

// Shell commands the agent left running in the background, with how long each has run and a Stop.
export function BackgroundShells() {
  const shells = useStore((s) => s.session.shells ?? NONE);
  const now = useTick(1000, shells.length > 0);
  if (!shells.length) return null;
  return (
    <div className="cp-bg" role="group" aria-label="Background tasks">
      {shells.map((t) => (
        <div key={t.toolUseId} className="cp-bg-row">
          <Icon name="terminal" small />
          <span className="cp-bg-label" title={t.label}>{t.label}</span>
          <span className="cp-bg-time">{elapsed(now - t.startedAt)}</span>
          <IconButton icon="debug-stop" label={`Stop ${t.label}`} size="sm" onClick={() => stopTask(t.toolUseId)} />
        </div>
      ))}
    </div>
  );
}
