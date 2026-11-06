import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex } from '../data';
import { followThrough } from '../data/meetings';
import type { ItemRow } from '../data/sync';
import { save, stored } from '../../ui/util';
import { dayLabel } from '../data/dates';
import { useActions } from '../useActions';
import { Capped } from '../Fold';
import { CardRow } from './CardRow';
import { Button } from '../../ui/Button';
import { MenuItem } from '../../ui/Menu';
import { Section } from '../../ui/Section';
import { haptic } from '../../ui/haptic';
import { focusPast, openMeeting, showSnack, useView } from '../view';

const DISMISSED = 'agentview:followThrough';

// Open actions from meetings over a week old: Make a task unlinks one from its meeting so it is a plain task, Dismiss hides it here.
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
  const write = (next: string[]) => {
    setDismissed(next);
    save(DISMISSED, next);
  };
  const hide = (keys: string[]) => {
    const live = new Set(snap.items.filter((x) => !x.deleted && x.meeting_id).map((x) => x.profile + x.id));
    write([...new Set([...dismissed, ...keys])].filter((k) => live.has(k)));
  };
  const dismiss = (r: ItemRow) => hide([r.profile + r.id]);
  const dismissAll = () => {
    const before = dismissed;
    hide(rows.map(({ r }) => r.profile + r.id));
    showSnack(`${rows.length} dismissed`, () => write(before));
  };
  return { rows, dismiss, dismissAll };
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
      <Section label="Follow-through" count={rows.length}
        action={<Button variant="quiet" size="sm" onClick={() => { f.dismissAll(); focusPast(section.current); }}>Dismiss all {rows.length}</Button>} />
      <div className="as-group ov-queue-group">
        <Capped items={rows} render={({ r, m }) => (
          <CardRow key={r.profile + r.id} title={r.title} meta={`${m.title} · ${dayLabel(m.starts_at!)}`} onOpen={() => openMeeting(m)}
            action={{ icon: 'close', label: `Dismiss ${r.title}`, run: () => dismiss(r) }}
            menu={(choose) => (
              <>
                <MenuItem icon="add" onClick={choose(() => void store.update(r, { meeting_id: null }))}>Make a task</MenuItem>
                <MenuItem icon="check" onClick={choose(() => { haptic('success'); act.done(r); focusPast(section.current); })}>Mark done</MenuItem>
              </>
            )} />
        )} />
      </div>
    </section>
  );
}
