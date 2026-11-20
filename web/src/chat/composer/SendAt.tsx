import { useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { useChatRun } from '../../sessions/useChatRun';
import { laterDay } from './composerLogic';

const hourAhead = () => {
  const d = new Date(Date.now() + 3_600_000);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
};

export function SendAt({ typed, shell, sendLater }: { typed: boolean; shell: boolean; sendLater: (time: string) => void }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(hourAhead);
  const trigger = useRef<HTMLButtonElement>(null);
  const run = useChatRun(useStore((s) => s.session.id));
  if (shell) return null;
  const replaced = run && (run.kind === 'goal' || run.kind === 'loop') ? run.kind : null;
  return (
    <>
      <IconButton ref={trigger} className="later" icon="clock" label="Send at" title="Send this message at a time today or tomorrow" small disabled={!typed} onPointerDown={(e) => e.preventDefault()} onClick={() => { setTime(hourAhead()); setOpen((v) => !v); }} />
      {open && (
        <Menu trigger={trigger} onClose={() => setOpen(false)}>
          <div className="cp-later-pick">
            <input type="time" aria-label="Send at" value={time} onChange={(e) => setTime(e.target.value)} />
            {replaced && <span className="cp-hint">Replaces the running {replaced}</span>}
          </div>
          <MenuItem icon="clock" disabled={!time} onClick={() => { setOpen(false); sendLater(time); }}>{time ? `Send at ${time} ${laterDay(time)}` : 'Send at'}</MenuItem>
        </Menu>
      )}
    </>
  );
}
