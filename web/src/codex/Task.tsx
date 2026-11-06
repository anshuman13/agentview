import { useEffect, useRef, useState } from 'react';
import { useAssistantStore } from './data';
import { atTime, hasDay, nextNine, parseWhen, stripWhen } from './data/engine';
import { captureTask } from './captureTask';
import { isRepeat, parseRepeat } from './data/recur';
import { withEstimate } from './data/plan';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { firstLine, readFlag } from '../ui/util';
import { FILTER_LABEL, useFocusBack, type Filter } from './view';
import { useActions } from './useActions';
import { clock, EVENING, MORNING, when } from './time';
import { Swipe } from './Swipe';
import { rowKey } from './taskKeys';
import { ProfileDot } from './ProfileDot';
import { Check } from './TaskCheck';
import { tagList } from './AddSheet';
import { checkItems } from './taskChecklist';

export { UNROLL, useActions } from './useActions';

const DAY = 86400_000;

// Checklist lines in the notes, like "- [ ] call" and "- [x] done".
const checklist = (s: string | null) => {
  const items = checkItems(s);
  return { items, done: items.filter((c) => c.done).length, total: items.length };
};

// inDay: the row sits under its day and part-of-day headers, so it shows only an exact clock time.
// picking: selection mode, where a tap on a selectable row calls onOpen to toggle it and selected shows it chosen.
export function TaskRow({ row, onOpen, onGrab, lifted, inDay, picking, selected }: { row: ItemRow; onOpen: () => void; onGrab?: (e: React.PointerEvent) => void; lifted?: boolean; inDay?: boolean; picking?: boolean; selected?: boolean }) {
  const act = useActions();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const at = atTime(row.at);
  const now = Date.now();
  const isDone = row.status === 'done';
  const isNote = row.status === 'note';
  const pickable = !isDone && !isNote;
  const late = at != null ? Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY) : 0;
  const slot = at != null && new Date(at).getMinutes() === 0 && [MORNING, EVENING].includes(new Date(at).getHours());
  const due = at == null || isNote || isDone ? null : late > 0 ? `${late}d late` : !inDay ? when(at, now) : slot ? null : clock(at);
  const list = checklist(row.text);
  const preview = isRepeat(row.text) ? '' : firstLine(row.text);
  const extras = [isRepeat(row.text) && 'Repeats', list.total > 0 && `${list.done}/${list.total}`, ...tagList(row.tags).slice(0, 2).map((t) => `#${t}`), !isDone && row.priority === 3 && 'High', !isDone && row.priority === 2 && 'Medium'].filter(Boolean).join(' · ');
  const later = nextNine(new Date(Math.max(at ?? 0, now)), row.profile);
  const other: Profile = row.profile === 'work' ? 'personal' : 'work';
  const choose = (fn: () => void) => () => { setMenu(false); fn(); };
  const body = (
    <div className={`as-row ${row.profile}${isDone ? ' checked' : ''}${lifted ? ' lifted' : ''}${selected ? ' selected' : ''}`} data-row={row.profile + row.id} onPointerDown={picking ? undefined : (e) => { if (!(e.target as Element).closest('.as-more')) onGrab?.(e); }} onClick={picking && !pickable ? undefined : onOpen} role="button" aria-pressed={picking && pickable ? !!selected : undefined} tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && (picking ? (pickable && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())) : rowKey(e, row, onOpen, act))}>
      {picking && !isNote ? <span className={`as-check${isDone ? ' on' : selected ? ' picked' : ''}`}><Icon name={selected || isDone ? 'pass-filled' : 'circle-large-outline'} /></span> : <Check row={row} />}
      <div className="as-body">
        <div className="as-title">{row.title || '(Untitled)'}</div>
        {(due || extras) && (
          <div className="as-meta">
            {due && <span className={at! < now ? 'as-due late' : late === 0 ? 'as-due today' : 'as-due'}>{due}{at! < now && late <= 0 && <span className="sr-only"> overdue</span>}</span>}
            {due && extras && ' · '}
            {extras}
          </div>
        )}
        {isNote && !list.total && !row.people && preview && !/^https?:\/\/\S+$/.test(preview) && <div className="as-ctx"><span className="as-quote">{preview}</span></div>}
      </div>
      {row.status === 'suggested' && <span className="badge waiting">Needs you</span>}
      {!picking && (
        <span className="as-more" onClick={(e) => e.stopPropagation()}>
          <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <Menu trigger={more} onClose={() => setMenu(false)}>
              <MenuItem icon="arrow-right" onClick={choose(onOpen)}>Open</MenuItem>
              {isDone && <MenuItem icon="discard" onClick={choose(() => act.reopen(row))}>Not done</MenuItem>}
              {pickable && <MenuItem icon="clock" onClick={choose(() => act.snooze(row, later))}>Snooze</MenuItem>}
              {pickable && <MenuItem icon="calendar" onClick={choose(() => act.tomorrow(row))}>Tomorrow</MenuItem>}
              {pickable && <MenuItem icon="arrow-swap" onClick={choose(() => void act.move(row, other))}>Move to {FILTER_LABEL[other]}</MenuItem>}
              <MenuItem icon="trash" danger onClick={choose(() => act.remove(row))}>Delete</MenuItem>
            </Menu>
          )}
        </span>
      )}
    </div>
  );
  if (picking) return <Swipe>{body}</Swipe>;
  if (isNote || isDone) return <Swipe onDelete={() => act.remove(row)}>{body}</Swipe>;
  return <Swipe onRight={() => act.done(row)} onLeft={() => act.snooze(row, later)} leftLabel={when(later, now)} onDelete={() => act.remove(row)}>{body}</Swipe>;
}

// A quick add at the end of a day: Enter saves and keeps the field open for the next task.
export function AddTask({ day, today, filter, empty = false }: { day: number; today: number; filter: Filter; empty?: boolean }) {
  const store = useAssistantStore();
  const [on, setOn] = useState(false);
  const addButton = useFocusBack<HTMLButtonElement>(on);
  const [text, setText] = useState('');
  const busy = useRef(false);
  const [picked, setPicked] = useState<Profile | null>(null);
  const profile: Profile = filter !== 'all' ? filter : picked ?? (readFlag('assistant-personal', false) ? 'personal' : 'work');
  useEffect(() => {
    if (day !== today) return;
    const open = () => setOn(true);
    window.addEventListener('tasks:add', open);
    return () => window.removeEventListener('tasks:add', open);
  }, [day, today]);
  const add = async () => {
    const typed = text.trim();
    if (!typed || busy.current) return;
    busy.current = true;
    const rep = parseRepeat(typed);
    const w = rep ? null : parseWhen(typed);
    // A bare time like "3pm" in a later day's section means that day.
    const at = w?.at != null && day !== today && !hasDay(typed) ? new Date(day).setHours(new Date(w.at).getHours(), new Date(w.at).getMinutes(), 0, 0) : rep?.at ?? w?.at ?? (day === today ? null : new Date(day).setHours(9, 0, 0, 0));
    if (await captureTask(store, rep ? `${withEstimate(rep.title)}\n${rep.text}` : withEstimate(stripWhen(typed, w) || typed), profile, at)) setText('');
    busy.current = false;
  };
  if (!on && day !== today) return <button ref={addButton} className="as-add-quiet" aria-label="Add task" title="Add task" onClick={() => setOn(true)}><Icon name="add" small /></button>;
  if (!on) return <button ref={addButton} className="as-add" onClick={() => setOn(true)}><Icon name="add" /> {empty ? 'Nothing today' : 'Add task'}</button>;
  return (
    <div className="as-add on" data-no-swipe>
      {filter === 'all' ? (
        <button className="as-add-prof" title={`${FILTER_LABEL[profile]}, tap for ${FILTER_LABEL[profile === 'work' ? 'personal' : 'work']}`} aria-label={`Profile: ${FILTER_LABEL[profile]}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setPicked(profile === 'work' ? 'personal' : 'work')}><ProfileDot profile={profile} /></button>
      ) : <Icon name="add" />}
      <input
        autoFocus
        value={text}
        placeholder="New task"
        aria-label="New task"
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add(); else if (e.key === 'Escape') { setText(''); setOn(false); } }}
        onBlur={() => { if (!text.trim()) setOn(false); }}
      />
    </div>
  );
}
