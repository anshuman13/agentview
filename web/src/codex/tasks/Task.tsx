import { atTime, nextNine } from '../data/tasks/engine';
import type { ItemRow, Profile } from '../data/sync';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { MenuItem } from '../../ui/Menu';
import { FILTER_LABEL } from '../view';
import { useActions } from '../useActions';
import { clock, EVENING, MORNING, when } from './time';
import { Swipe } from '../gestures/Swipe';
import { rowKey } from './taskKeys';
import { Check } from './TaskCheck';
import { taskMetaParts } from './taskMeta';
import { Badge } from '../../ui/Badge';
import { UNTITLED } from '../../../../shared/util';

export { UNROLL, useActions } from '../useActions';

const DAY = 86400_000;

// A touch hold on a row starts selection (see the drag gesture), so the row's long press does not open its menu.
const noHold = () => undefined;

const lateDays = (at: number, now: number) => Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY);

// The due text of an open task row: Nd late, the day and time, or only the time when the row sits under its day (inDay). None for notes, done rows, undated tasks and the 09:00 and 19:00 slots.
export function dueText(row: ItemRow, now: number, inDay?: boolean) {
  const at = atTime(row.at);
  if (at == null || row.status === 'note' || row.status === 'done') return null;
  const late = lateDays(at, now);
  const slot = new Date(at).getMinutes() === 0 && [MORNING, EVENING].includes(new Date(at).getHours());
  return late > 0 ? `${late}d late` : !inDay ? when(at, now) : slot ? null : clock(at);
}

// The menu items of an open task: Open, Snooze, Tomorrow, Move to the other profile and Delete.
export function taskMenu(row: ItemRow, act: ReturnType<typeof useActions>, onOpen: () => void) {
  const later = nextNine(new Date(Math.max(atTime(row.at) ?? 0, Date.now())), row.profile);
  const other: Profile = row.profile === 'work' ? 'personal' : 'work';
  return (
    <>
      <MenuItem icon="arrow-right" onClick={onOpen}>Open</MenuItem>
      <MenuItem icon="clock" onClick={() => act.snooze(row, later)}>Snooze</MenuItem>
      <MenuItem icon="calendar" onClick={() => act.tomorrow(row)}>Tomorrow</MenuItem>
      <MenuItem icon="arrow-swap" onClick={() => void act.move(row, other)}>Move to {FILTER_LABEL[other]}</MenuItem>
      <MenuItem icon="trash" danger onClick={() => act.remove(row)}>Delete</MenuItem>
    </>
  );
}

// inDay: the row sits under its day header, so it shows only an exact clock time.
// picking: selection mode, where a tap on a selectable row calls onOpen to toggle it and selected shows it chosen.
export function TaskRow({ row, onOpen, onGrab, lifted, inDay, picking, selected }: { row: ItemRow; onOpen: () => void; onGrab?: (e: React.PointerEvent) => void; lifted?: boolean; inDay?: boolean; picking?: boolean; selected?: boolean }) {
  const act = useActions();
  const at = atTime(row.at);
  const now = Date.now();
  const isDone = row.status === 'done';
  const isNote = row.status === 'note';
  const pickable = !isDone && !isNote;
  const late = at != null ? lateDays(at, now) : 0;
  const due = dueText(row, now, inDay);
  const { extra, preview } = taskMetaParts(row);
  const later = nextNine(new Date(Math.max(at ?? 0, now)), row.profile);
  const meta = due || extra ? (
    <>
      {due && <span className={at! < now ? 'as-due late' : late === 0 ? 'as-due today' : 'as-due'}>{due}{at! < now && late <= 0 && <span className="sr-only"> overdue</span>}</span>}
      {due && extra && ' · '}
      {extra}
    </>
  ) : preview;
  const body = (
    <Row plain className={`tk-row ${row.profile}${isDone ? ' checked' : ''}${lifted ? ' lifted' : ''}${selected ? ' selected' : ''}`} data-row={row.profile + row.id} onPointerDown={picking ? undefined : onGrab} onLongPress={noHold} onClick={picking && !pickable ? undefined : onOpen} role="button" aria-pressed={picking && pickable ? !!selected : undefined} tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && (picking ? (pickable && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())) : rowKey(e, row, onOpen, act))}
      leading={picking && !isNote ? <span className={`as-check${isDone ? ' on' : selected ? ' picked' : ''}`}><Icon name={selected || isDone ? 'pass-filled' : 'circle-large-outline'} /></span> : <Check row={row} />}
      title={row.title || UNTITLED}
      meta={meta}
      state={row.status === 'suggested' ? <Badge status="waiting" label="Needs you" /> : null}
      menu={!picking && (pickable ? taskMenu(row, act, onOpen) : (
        <>
          <MenuItem icon="arrow-right" onClick={onOpen}>Open</MenuItem>
          {isDone && <MenuItem icon="discard" onClick={() => act.reopen(row)}>Not done</MenuItem>}
          <MenuItem icon="trash" danger onClick={() => act.remove(row)}>Delete</MenuItem>
        </>
      ))}
    />
  );
  if (picking) return <Swipe>{body}</Swipe>;
  if (isNote || isDone) return <Swipe onDelete={() => act.remove(row)}>{body}</Swipe>;
  return <Swipe onRight={() => act.done(row)} onLeft={() => act.snooze(row, later)} leftLabel={when(later, now)} onDelete={() => act.remove(row)}>{body}</Swipe>;
}
