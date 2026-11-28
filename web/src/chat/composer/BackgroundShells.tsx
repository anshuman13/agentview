import { useLayoutEffect, useRef, useState } from 'react';
import { shellRows, type ShellRow } from '../../../../shared/backgroundShells';
import { useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Button, IconButton } from '../../ui/Button';
import { useTick } from '../../ui/util';
import { clearShells, stopTask } from '../chatActions';

const NONE: never[] = [];

// Shell commands the agent left running in the background under "Running N", each with how long it has run and a Stop, then
// "Finished N" with their duration; every row opens to its command and output. Android: Composer.kt BackgroundShells.
export function BackgroundShells() {
  const shells = useStore((s) => s.session.shells ?? NONE);
  const now = useTick(1000, shells.some((t) => !t.endedAt));
  const [open, setOpen] = useState<string | null>(null);
  if (!shells.length) return null;
  const { running, finished } = shellRows(shells, now);
  const row = (t: ShellRow, stop: boolean) => (
    <div key={t.toolUseId}>
      <div className="cp-bg-row">
        <button type="button" className="cp-bg-done" aria-expanded={open === t.toolUseId} onClick={() => setOpen(open === t.toolUseId ? null : t.toolUseId)}>
          <Icon name={t.failed ? 'error' : 'terminal'} small color={t.failed ? 'var(--danger)' : undefined} />
          <span className="cp-bg-label" title={t.label}>{t.label}</span>
          <span className="cp-bg-time">{t.time}</span>
          <Icon name={open === t.toolUseId ? 'chevron-down' : 'chevron-right'} small />
        </button>
        {stop && <IconButton icon="debug-stop" label={`Stop ${t.label}`} size="sm" onClick={() => stopTask(t.toolUseId)} />}
      </div>
      {open === t.toolUseId && <ShellOutput text={t.detail} />}
    </div>
  );
  return (
    <div className="cp-bg" role="group" aria-label="Background tasks">
      {running.length > 0 && (
        <div className="cp-bg-row cp-bg-head">
          <span className="cp-bg-label">Running {running.length}</span>
        </div>
      )}
      {running.map((t) => row(t, true))}
      {finished.length > 0 && (
        <div className="cp-bg-row cp-bg-head">
          <span className="cp-bg-label">Finished {finished.length}</span>
          <Button variant="quiet" size="sm" onClick={clearShells}>Clear</Button>
        </div>
      )}
      {finished.map((t) => row(t, false))}
    </div>
  );
}

// The open output follows its end as a running command writes more.
function ShellOutput({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return <pre ref={ref} className="cp-bg-out">{text}</pre>;
}
