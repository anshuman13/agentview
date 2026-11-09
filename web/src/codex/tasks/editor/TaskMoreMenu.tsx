import { useRef, useState } from 'react';
import { useAssistant } from '../../data';
import { atTime } from '../../data/tasks/engine';
import type { ItemRow, Profile } from '../../data/sync';
import { Icon } from '../../../ui/Icon';
import { Chip, IconButton } from '../../../ui/Button';
import { Menu, MenuItem } from '../../../ui/Menu';
import { safeHref } from '../../../ui/util';
import { copyText, FILTER_LABEL, setView, showSnack } from '../../view';
import { useActions } from '../../useActions';
import { clock, PickTime } from '../time';
import { snoozeText, snoozes } from '../../AskBar';
import { recentPeople } from '../../data/meetings/points';
import { RaiseWith } from '../../meetings/Raise';
import { sourceOf } from '../taskSource';
import { afterNextMeeting, minutesText, nextFreeSlot, timedMeetings, type Span } from '../../data/tasks/plan';
import { isFocused, startFocus, stopFocus, useFocus } from '../../focus';
import { GoalPick } from '../Goals';
import { live } from '../../data/wiki/wiki';
import { dayEnd, dayStart } from '../../data/dates';
import { REMINDS } from '../AddSheet';
import type { useTaskDraft } from './draft';

type Draft = ReturnType<typeof useTaskDraft>;

type Props = {
  row: ItemRow;
  draft: Draft;
  suggested: number | null;
  addEstimate: (n: number) => void;
  then: (f: () => void) => () => void;
  onAsk: (r: ItemRow) => void;
};

export function TaskMoreMenu({ row, draft, suggested, addEstimate, then, onAsk }: Props) {
  const act = useActions();
  const { store, snap } = useAssistant();
  const { title, text, setTitle, setText, save, write, saving } = draft;
  const [menu, setMenu] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [logging, setLogging] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const src = sourceOf(row);
  const at = atTime(row.at);
  const focused = isFocused(useFocus(), row);
  const other: Profile = row.profile === 'work' ? 'personal' : 'work';
  const logTime = (n: number) => write({ spent: (Number(row.spent) || 0) + n });
  // The move waits for the last save, so the phone's store copies the saved title and notes to the other profile.
  const move = () => {
    save();
    void saving.current.then(() => act.move(row, other));
  };
  const freeTimes = () => {
    const now = Date.now();
    const busy = timedMeetings(live(snap.meetings).filter((m) => m.profile === row.profile && m.starts_at != null && m.starts_at >= dayStart(now) && m.starts_at < dayEnd(now))).map((m) => [m.starts_at!, m.ends_at!] as Span);
    return ([['After next meeting', afterNextMeeting(busy, now)], ['Next free slot', nextFreeSlot(busy, now)]] as const).flatMap(([label, t]) => (t == null ? [] : [[label, t] as const]));
  };
  // Haiku fixes a quick or dictated task into a clear title and notes, and sets the time if the text says one.
  const tidy = async () => {
    setTidying(true);
    try {
      const p = await store.parse([title, text].filter((s) => s.trim()).join('\n'), row.profile);
      setTitle(p.title);
      setText(p.details ?? '');
      if (p.at != null && row.at == null) act.edit(row, { at: p.at });
    } catch (err) {
      showSnack(`Not tidied: ${(err as Error).message}`);
    } finally {
      setTidying(false);
    }
  };

  const snoozeItems = (
    <>
      <MenuItem onClick={() => setSnoozing(false)} icon="arrow-left">Snooze</MenuItem>
      {at != null && at >= new Date().setHours(24, 0, 0, 0) && <MenuItem onClick={then(() => act.due(row, null))}>Today</MenuItem>}
      {snoozes().flatMap((s) => [
        <MenuItem key={s.label} onClick={then(() => act.snooze(row, s.at(new Date(), row.profile)))}>{snoozeText(s, new Date(), row.profile)}</MenuItem>,
        ...(s.label === 'In 3 hours' ? freeTimes().map(([label, t]) => <MenuItem key={label} onClick={then(() => act.snooze(row, t))}>{label} · {clock(t)}</MenuItem>) : []),
      ])}
      <PickTime className="ui-menu-item" value={at} onPick={(t) => then(() => act.snooze(row, t))()} />
    </>
  );

  const mainItems = (
    <>
      {row.status === 'open' && <MenuItem onClick={() => setSnoozing(true)} icon="clock">Snooze</MenuItem>}
      {row.status === 'open' && <MenuItem onClick={then(() => act.tomorrow(row))} icon="calendar">Tomorrow</MenuItem>}
      {row.status === 'open' && (focused
        ? <MenuItem onClick={() => { setMenu(false); stopFocus(); }} icon="debug-stop">Stop focus</MenuItem>
        : <MenuItem onClick={() => { setMenu(false); save(); startFocus(row); }} icon="play">Start focus</MenuItem>)}
      <MenuItem onClick={() => { setMenu(false); move(); }} icon="arrow-swap">Move to {FILTER_LABEL[other]}</MenuItem>
      {suggested != null && <MenuItem title="Add this estimate, from similar done tasks" onClick={() => { setMenu(false); addEstimate(suggested); }} icon="add">Add estimate ~{minutesText(suggested)}</MenuItem>}
      {(row.status === 'open' || row.status === 'done') && (
        <>
          <MenuItem aria-label="Log time" aria-expanded={logging} onClick={() => setLogging(!logging)} icon="watch">Log time{Number(row.spent) > 0 && ` (${minutesText(Number(row.spent))})`}</MenuItem>
          {logging && <div className="as-tt-menu-chips">{[15, 30, 60].map((n) => <Chip key={n} size="sm" title={`Add ${minutesText(n)} spent`} onClick={() => logTime(n)}>+{minutesText(n)}</Chip>)}</div>}
          {at != null && row.status === 'open' && (
            <label className="ui-menu-item as-tt-menu-row"><Icon name="bell" small />
              <select value={String(row.remind ?? null)} aria-label="Reminder" onChange={(e) => act.edit(row, { remind: e.target.value === 'null' ? null : Number(e.target.value) })}>
                {REMINDS.map(([v, l]) => <option key={l} value={String(v)}>Reminder: {l}</option>)}
              </select>
            </label>
          )}
          <div className="ui-menu-item as-tt-menu-row"><Icon name="target" small /><GoalPick row={row} onPick={(goal) => act.edit(row, { goal })} /></div>
        </>
      )}
      {row.meeting_id && <MenuItem onClick={then(() => setView({ list: 'meetings', open: `${row.profile}:${row.meeting_id}` }))} icon="record">Open meeting</MenuItem>}
      {row.source_url && <MenuItem href={safeHref(row.source_url)} onClick={() => setMenu(false)} icon={src.icon}>{row.meeting_id ? 'Transcript' : src.label}</MenuItem>}
      {row.status === 'note' && <MenuItem onClick={then(() => act.toTask(row))} icon="check">Make task</MenuItem>}
      {row.status === 'open' && <MenuItem disabled={tidying} onClick={() => { setMenu(false); void tidy(); }} icon={tidying ? 'loading' : 'wand'} spin={tidying}>Tidy</MenuItem>}
      {row.draft && <MenuItem onClick={() => { setMenu(false); copyText(row.draft!); }} icon="copy">Copy draft</MenuItem>}
      {row.status === 'open' && <RaiseWith className="ui-menu-item" text={title} profile={row.profile} people={recentPeople(snap.meetings, row.profile, snap.meetings.find((m) => m.profile === row.profile && m.id === row.meeting_id))} />}
      <MenuItem onClick={then(() => onAsk(row))} icon="sparkle">Ask Claude</MenuItem>
      {at != null && <MenuItem onClick={() => { setMenu(false); act.due(row, null); }} icon="close">Clear due time</MenuItem>}
      <MenuItem danger onClick={then(() => act.remove(row))} icon="trash">Delete</MenuItem>
    </>
  );

  return (
    <div className="as-tt-more">
      <IconButton ref={moreBtn} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu(!menu); setSnoozing(false); }} />
      {menu && (
        <Menu key={snoozing ? 'snooze' : 'main'} trigger={moreBtn} className="as-tt-menu" onClose={() => { setMenu(false); setSnoozing(false); }}>
          {snoozing ? snoozeItems : mainItems}
        </Menu>
      )}
    </div>
  );
}
