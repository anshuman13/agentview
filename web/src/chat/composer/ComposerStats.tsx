import { useEffect, useRef, useState } from 'react';
import { sinceHeard, useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { compactAt, type ChatEvent } from '../../../../shared/protocol';
import { contextPercent, filesEdited } from './composerLogic';
import { ContextPanel } from './ContextPanel';

let editedFor: ChatEvent[] | undefined;
let editedCount = 0;
const editedOf = (events: ChatEvent[]) => (events === editedFor ? editedCount : ((editedFor = events), (editedCount = filesEdited(events))));

function useStaleSeconds() {
  const [stale, setStale] = useState(0);
  useEffect(() => {
    const tick = () => setStale(document.visibilityState === 'visible' ? sinceHeard() : 0);
    const t = setInterval(tick, 5_000);
    return () => clearInterval(t);
  }, []);
  return stale;
}

export function ComposerStats({ hint }: { hint: string }) {
  const running = useStore((s) => s.session.running);
  const compacting = useStore((s) => s.session.compacting);
  const context = useStore((s) => s.session.context);
  const contextWindow = useStore((s) => s.session.contextWindow);
  const edited = useStore((s) => editedOf(s.events));
  const stale = useStaleSeconds();
  const pct = contextPercent(context, contextWindow);
  const limit = compactAt(contextWindow);
  const level = context === null ? '' : context >= limit ? 'over' : context >= limit * 0.75 ? 'near' : '';
  const [open, setOpen] = useState(false);
  const meter = useRef<HTMLButtonElement>(null);
  return (
    <div className="cp-under">
      {hint && <span className="cp-hint">{hint}</span>}
      <span className="cp-stats">
        {compacting ? <span><Icon name="loading" small spin /> Compacting…</span> : pct !== null && (
          <button ref={meter} className={`cp-ctx ${level}`} title={`${context!.toLocaleString()} tokens in context. Tap for the breakdown`} onClick={() => setOpen((v) => !v)}>{pct}% context</button>
        )}
        {edited > 0 && <span>{edited} {edited === 1 ? 'file' : 'files'} edited</span>}
        {stale >= 30 && <span className="cp-stale" title="Nothing has arrived from the server. The link is reopened after 50 s of silence.">No update for {stale}s</span>}
      </span>
      {open && <ContextPanel trigger={meter} onClose={() => setOpen(false)} />}
    </div>
  );
}
