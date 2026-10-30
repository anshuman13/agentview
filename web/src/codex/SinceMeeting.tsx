import { useMemo, useRef, useState } from 'react';
import { useAssistantData } from './data';
import { sinceMeeting } from './data/load';
import { ActionRow } from './meetings/Meetings';
import { focusPast, useView } from './view';
import { ago, safeHref, save, stored } from '../ui/util';

const DISMISSED = 'codex.sinceMeetingDismissed';

// After a meeting, the Slack and mail asks and the DMs that came in while it ran; Dismiss hides it for that meeting.
export function SinceMeeting({ now }: { now: number }) {
  const snap = useAssistantData();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const section = useRef<HTMLElement>(null);
  const minute = Math.floor(now / 60000);
  const r = useMemo(() => {
    const pick = <T extends { profile: string }>(rows: T[]) => rows.filter((x) => filter === 'all' || x.profile === filter);
    return sinceMeeting(pick(snap.meetings), pick(snap.items), pick(snap.chats), dismissed, minute * 60000);
  }, [snap.meetings, snap.items, snap.chats, filter, dismissed, minute]);
  if (!r) return null;
  const dismiss = () => {
    const next = [...dismissed.slice(-20), r.key];
    setDismissed(next);
    save(DISMISSED, next);
    focusPast(section.current);
  };
  return (
    <section ref={section}>
      <div className="as-section">Since {r.m.title ?? 'the meeting'}</div>
      {r.asks.length > 0 && <div className="as-group">{r.asks.map((x) => <ActionRow key={x.profile + x.id} row={x} />)}</div>}
      <div className="ov-follow" role="list" aria-label="Slack messages">
        {r.dms.map((c) => (
          <div key={c.profile + c.id} className="ov-follow-row" role="listitem">
            <a className="ov-follow-text" href={safeHref(c.url)} target="_blank" rel="noreferrer">
              <span className="ov-t">{c.name}</span>
              <span className="muted small">{c.last_at ? `${ago(c.last_at, ' ago')} · ` : ''}{c.summary}</span>
            </a>
          </div>
        ))}
        <div className="ov-follow-row" role="listitem">
          <span className="ov-follow-text" />
          <button className="btn sm" aria-label={`Dismiss since ${r.m.title ?? 'the meeting'}`} onClick={dismiss}>Dismiss</button>
        </div>
      </div>
    </section>
  );
}
