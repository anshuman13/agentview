import { useEffect, useRef, useState } from 'react';
import { useAssistant } from './data';
import { atTime, errorText, hasDay, nextNine, parseWhen, stripWhen } from './data/engine';
import { isRepeat, parseRepeat } from './data/recur';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { firstLine, readFlag, saveFlag } from '../ui/util';
import { FILTER_LABEL, showSnack, takeTask, useFocusBack, type Filter } from './view';
import { useActions } from './useActions';
import { when } from './time';
import { Swipe } from './Swipe';
import { rowKey } from './taskKeys';
import { ProfileDot } from './ProfileDot';
import { haptic } from '../ui/haptic';
import { estimateMin, minutesText } from './data/plan';
import { sourceOf } from './taskSource';
import { Check } from './TaskCheck';
import { TaskEditor } from './TaskEditor';
import { checkItems, toggleCheck } from './taskChecklist';

export { UNROLL, useActions } from './useActions';

const DAY = 86400_000;

// Checklist lines in the notes, like "- [ ] call" and "- [x] done".
const checklist = (s: string | null) => {
  const items = checkItems(s);
  return { items, done: items.filter((c) => c.done).length, total: items.length };
};

export function TaskRow({ row, open, onOpen, onClose, onAsk, onGrab, lifted }: { row: ItemRow; open: boolean; onOpen: () => void; onClose: () => void; onAsk: (r: ItemRow) => void; onGrab?: (e: React.PointerEvent) => void; lifted?: boolean }) {
  const act = useActions();
  const { store } = useAssistant();
  const [showList, setShowList] = useState(false);
  useEffect(() => {
    if (open || !takeTask(row.profile + row.id)) return;
    onOpen();
    requestAnimationFrame(() => document.querySelector('.as-edit')?.scrollIntoView({ block: 'nearest' }));
  }, []);
  if (open) return <TaskEditor row={row} onClose={onClose} onAsk={onAsk} />;
  const src = sourceOf(row);
  const at = atTime(row.at);
  const now = Date.now();
  const isDone = row.status === 'done';
  const isNote = row.status === 'note';
  const late = at != null ? Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY) : 0;
  const due = at != null && !isNote && !isDone ? (late > 0 ? `${late}d late` : when(at, now)) : null;
  const est = estimateMin(row.title);
  const list = checklist(row.text);
  const preview = isRepeat(row.text) ? '' : firstLine(row.text);
  const body = (
    <div className={`as-row ${row.profile}${isDone ? ' checked' : ''}${lifted ? ' lifted' : ''}`} data-row={row.profile + row.id} onPointerDown={onGrab} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && rowKey(e, row, onOpen, act)}>
      <Check row={row} />
      <div className="as-body">
        <div className="as-title"><ProfileDot profile={row.profile} />{row.title || '(Untitled)'}</div>
        <div className="as-ctx">
          {due && <span className={at! < now ? 'as-due late' : 'as-due'}>{due}{at! < now && late <= 0 && <span className="sr-only"> overdue</span>}</span>}
          {est != null && !isDone && <span className="as-chip" title="Estimate">{minutesText(est)}</span>}
          {isRepeat(row.text) && <span title="Repeats" role="img" aria-label="Repeats"><Icon name="sync" small /></span>}
          {row.rolled_from != null && !isDone && <span>from {new Date(row.rolled_from).toLocaleDateString([], { weekday: 'short' })}</span>}
          {row.source && row.source !== 'capture' && <span className={`as-src ${row.source}`} title={src.label} role="img" aria-label={src.label}><Icon name={src.icon} small /></span>}
          {!isDone && row.text?.split('\n').includes('Replied in Slack') && <span className="as-quote" title="Replied in Slack"><Icon name="reply" small /> Replied</span>}
          {list.total > 0 && <span className={list.done === list.total ? 'as-list-done' : undefined}><button className="as-list-btn" aria-expanded={showList} aria-label="Checklist" onClick={(e) => { e.stopPropagation(); setShowList(!showList); }}><Icon name="checklist" small /> {list.done}/{list.total}</button></span>}
          {row.people && <span className="as-people">{row.people}</span>}
          {!list.total && !row.people && preview && !/^https?:\/\/\S+$/.test(preview) && <span className="as-quote">{preview}</span>}
        </div>
        {showList && list.total > 0 && (
          <div className="as-list" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            {list.items.map((c, i) => (
              <button key={i} role="checkbox" aria-checked={c.done} className={c.done ? 'on' : undefined} onClick={() => { haptic('tap'); void store.update(row, { text: toggleCheck(row.text ?? '', i) }); }}>
                <Icon name={c.done ? 'pass-filled' : 'circle-large-outline'} small /> <span>{c.label || '(empty)'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  if (isNote || isDone) return <Swipe onDelete={() => act.remove(row)}>{body}</Swipe>;
  const later = nextNine(new Date(Math.max(at ?? 0, now)), row.profile);
  return <Swipe onRight={() => act.done(row)} onLeft={() => act.snooze(row, later)} leftLabel={when(later, now)} onDelete={() => act.remove(row)}>{body}</Swipe>;
}

// A quick add at the end of a day: Enter saves and keeps the field open for the next task.
export function AddTask({ day, today, filter }: { day: number; today: number; filter: Filter }) {
  const { store } = useAssistant();
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
    try {
      const row = await store.capture(rep ? `${rep.title}\n${rep.text}` : stripWhen(typed, w) || typed, 'task', profile, at);
      setText('');
      saveFlag('assistant-personal', profile === 'personal');
      haptic('tap');
      showSnack(at != null ? `Task · ${when(at)}` : 'Task · No time', () => void store.update(row, { deleted: 1 }));
    } catch (err) {
      showSnack(`Not saved: ${errorText(err)}`);
    } finally {
      busy.current = false;
    }
  };
  if (!on) return <button ref={addButton} className="as-add" onClick={() => setOn(true)}><Icon name="add" /> Add task</button>;
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
