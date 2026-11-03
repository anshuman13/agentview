import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex } from '../data';
import { followThrough } from '../data/meetings';
import type { ItemRow } from '../data/sync';
import { save, stored } from '../../ui/util';
import { dayLabel } from '../data/dates';
import { useActions } from '../useActions';
import { Capped } from '../Fold';
import { haptic } from '../../ui/haptic';
import { focusPast, openMeeting, useView } from '../view';

const DISMISSED = 'agentview:followThrough';

// Open actions from meetings over a week old: Task unlinks one from its meeting so it is a plain task, Dismiss hides it here.
export function useFollowThrough() {
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const minute = Math.floor(Date.now() / 60000);
  const rows = useMemo(
    () => followThrough(snap.items, meetings.filter((m) => filter === 'all' || m.profile === filter), dismissed, minute * 60000),
    [snap.items, meetings, filter, dismissed, minute],
  );
  const dismiss = (r: ItemRow) => {
    const live = new Set(snap.items.filter((x) => !x.deleted && x.meeting_id).map((x) => x.profile + x.id));
    const next = [...new Set([...dismissed, r.profile + r.id])].filter((k) => live.has(k));
    setDismissed(next);
    save(DISMISSED, next);
  };
  return { rows, dismiss };
}

export function FollowThrough({ f }: { f: ReturnType<typeof useFollowThrough> }) {
  const store = useAssistantStore();
  const act = useActions();
  const section = useRef<HTMLElement>(null);
  const { rows } = f;
  const dismiss = (r: ItemRow) => { f.dismiss(r); focusPast(section.current); };
  if (!rows.length) return null;
  return (
    <section ref={section}>
      <div className="as-section">Follow-through · {rows.length}</div>
      <div className="ov-follow">
        <Capped items={rows} render={({ r, m }) => (
          <div key={r.profile + r.id} className="ov-follow-row">
            <button className="ov-follow-text" onClick={() => openMeeting(m)}>
              <span className="ov-t">{r.title}</span>
              <span className="muted small">{m.title} · {dayLabel(m.starts_at!)}</span>
            </button>
            <button className="btn btn-sm btn-gray" aria-label={`Make ${r.title} a plain task`} onClick={() => void store.update(r, { meeting_id: null })}>Task</button>
            <button className="btn btn-sm btn-gray" aria-label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); focusPast(section.current); }}>Done</button>
            <button className="btn btn-sm btn-gray" aria-label={`Dismiss ${r.title}`} onClick={() => dismiss(r)}>Dismiss</button>
          </div>
        )} />
      </div>
    </section>
  );
}
