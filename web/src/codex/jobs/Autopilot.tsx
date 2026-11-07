import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantTable } from '../data';
import type { AutopilotState } from '../data/store';
import { Row } from '../../ui/Row';
import { Switch } from './Switch';
import { replyQueue } from '../overview/ReplyQueue';
import { setView } from '../view';
import { modeLine } from './autopilotRows';

// Set when the page goes back, so the row it came from takes focus again.
let refocus = false;
export const focusRowOnReturn = () => { refocus = true; };

// The row for replying on my behalf in Slack: the mode in one line, the switch, and a tap opens the page.
export function Autopilot() {
  const store = useAssistantStore();
  const [state, setState] = useState<AutopilotState | null>(null);
  const [error, setError] = useState('');
  const items = useAssistantTable('items');
  const group = useRef<HTMLDivElement>(null);
  const waiting = useMemo(() => replyQueue(items, Date.now()).length, [items]);
  const load = (p: Promise<AutopilotState>) => p.then((s) => { setState(s); setError(''); }).catch((err) => setError((err as Error).message));
  useEffect(() => void load(store.autopilot()), [store]);
  useEffect(() => {
    if (refocus) group.current?.querySelector<HTMLElement>('[role=button]')?.focus({ preventScroll: true });
    refocus = false;
  }, []);
  const c = state?.config;
  const open = () => setView({ open: 'autopilot' });
  return (
    <section aria-label="Autopilot">
      <div className="ui-group" ref={group}>
        <Row plain role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
          title="Reply for me in Slack" meta={error || (state ? modeLine(state, waiting) : 'Loading')}
          trailing={c && <Switch on={c.enabled} label="Reply for me in Slack" onChange={(on) => void load(store.autopilot({ enabled: on }))} />} />
      </div>
    </section>
  );
}
