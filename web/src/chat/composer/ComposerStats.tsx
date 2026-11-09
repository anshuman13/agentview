import { useEffect, useState } from 'react';
import { send, sinceHeard, useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { COMPACT_AT, type ChatEvent } from '../../../../shared/protocol';
import { contextPercent, filesEdited } from './composerLogic';

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
  const edited = useStore((s) => editedOf(s.events));
  const stale = useStaleSeconds();
  const pct = contextPercent(context);
  const level = context === null ? '' : context >= COMPACT_AT ? 'over' : context >= COMPACT_AT * 0.75 ? 'near' : '';
  return (
    <div className="cp-under">
      {hint && <span className="cp-hint">{hint}</span>}
      <span className="cp-stats">
        {compacting ? <span><Icon name="loading" small spin /> Compacting…</span> : level && (
          <button className={`cp-ctx ${level}`} disabled={running} title={`${context!.toLocaleString()} tokens in context. ${running ? 'Compacts when this turn ends' : 'Tap to compact'}.`} onClick={() => send({ type: 'prompt', text: '/compact' })}>{pct}% context{!running && ' · compact'}</button>
        )}
        {edited > 0 && <span>{edited} {edited === 1 ? 'file' : 'files'} edited</span>}
        {stale >= 30 && <span className="cp-phase cp-stale" title="Nothing has arrived from the server. The link is reopened after 50 s of silence.">No update for {stale}s</span>}
      </span>
    </div>
  );
}
