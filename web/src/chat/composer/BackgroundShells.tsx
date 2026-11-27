import { useState } from 'react';
import { shellRows } from '../../../../shared/backgroundShells';
import { useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Button, IconButton } from '../../ui/Button';
import { useTick } from '../../ui/util';
import { clearShells, stopTask } from '../chatActions';

const NONE: never[] = [];

// Shell commands the agent left running in the background, with how long each has run and a Stop, then the finished ones
// with their duration, opening to the command and its last output. Android: Composer.kt BackgroundShells.
export function BackgroundShells() {
  const shells = useStore((s) => s.session.shells ?? NONE);
  const now = useTick(1000, shells.some((t) => !t.endedAt));
  const [open, setOpen] = useState<string | null>(null);
  if (!shells.length) return null;
  const { running, finished } = shellRows(shells, now);
  return (
    <div className="cp-bg" role="group" aria-label="Background tasks">
      {running.map((t) => (
        <div key={t.toolUseId} className="cp-bg-row">
          <Icon name="terminal" small />
          <span className="cp-bg-label" title={t.label}>{t.label}</span>
          <span className="cp-bg-time">{t.time}</span>
          <IconButton icon="debug-stop" label={`Stop ${t.label}`} size="sm" onClick={() => stopTask(t.toolUseId)} />
        </div>
      ))}
      {finished.length > 0 && (
        <div className="cp-bg-row cp-bg-head">
          <span className="cp-bg-label">Finished</span>
          <Button variant="quiet" size="sm" onClick={clearShells}>Clear</Button>
        </div>
      )}
      {finished.map((t) => (
        <div key={t.toolUseId}>
          <button type="button" className="cp-bg-row cp-bg-done" aria-expanded={open === t.toolUseId} onClick={() => setOpen(open === t.toolUseId ? null : t.toolUseId)}>
            <Icon name={t.failed ? 'error' : 'terminal'} small color={t.failed ? 'var(--danger)' : undefined} />
            <span className="cp-bg-label" title={t.label}>{t.label}</span>
            <span className="cp-bg-time">{t.time}</span>
            <Icon name={open === t.toolUseId ? 'chevron-down' : 'chevron-right'} small />
          </button>
          {open === t.toolUseId && <pre className="cp-bg-out">{t.detail}</pre>}
        </div>
      ))}
    </div>
  );
}
