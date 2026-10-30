import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAssistant } from './data';
import { atTime, errorText, hasDay, nextNine, parseWhen, stripWhen } from './data/engine';
import { isRepeat, nextRepeat, parseRepeat } from './data/recur';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { ago, readFlag, safeHref, saveFlag } from '../ui/util';
import { FILTER_LABEL, setView, showSnack, type Filter } from './view';
import { PickDue, PickTime, when } from './time';
import { snoozes } from './AskBar';
import { isDragging } from './drag';
import { Back } from '../app/back';
import { ProfileDot } from './ProfileDot';
import { haptic } from '../ui/haptic';
import { estimateMin, minutesText } from './data/plan';

const SOURCES: Record<string, { icon: string; label: string }> = {
  slack: { icon: 'comment-discussion', label: 'Slack' },
  linear: { icon: 'issues', label: 'Linear' },
  gmail: { icon: 'mail', label: 'Gmail' },
  mail: { icon: 'mail', label: 'Mail' },
  calendar: { icon: 'calendar', label: 'Calendar' },
  meeting: { icon: 'record', label: 'Meeting' },
  action: { icon: 'checklist', label: 'Meeting' },
  github: { icon: 'github', label: 'GitHub' },
  capture: { icon: 'edit', label: 'You' },
  job: { icon: 'history', label: 'Job' },
};
export const sourceOf = (r: ItemRow) => SOURCES[r.source ?? 'capture'] ?? { icon: 'circle-small', label: r.source ?? '' };

const SWIPE = 80;
// A left swipe past this share of the row deletes instead of snoozing.
const SWIPE_DELETE = 0.55;
const DAY = 86400_000;

const firstLine = (s: string | null) => s?.split('\n').find((l) => l.trim())?.trim() ?? '';
const CHECK_RE = /^\s*[-*] \[([ xX])\](.*)$/gm;
// Checklist lines in the notes, like "- [ ] call" and "- [x] done".
const checklist = (s: string | null) => {
  const all = s?.match(/^\s*[-*] \[[ xX]\]/gm) ?? [];
  return { done: all.filter((l) => /x/i.test(l)).length, total: all.length };
};

export const UNROLL = { rolls: null, rolled_from: null };

export function useActions() {
  const { store } = useAssistant();
  const change = (r: ItemRow, patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]])) as Patch;
    void store.update(r, patch);
    showSnack(text, () => void store.update(r, before));
  };
  return {
    done: (r: ItemRow) => {
      const next = nextRepeat(r, Date.now(), store.snapshot().items);
      if (!next) return change(r, { status: 'done' }, 'Done');
      const made = store.capture(`${next.title}\n${next.text}`, 'task', r.profile, next.at).catch(() => null);
      void store.update(r, { status: 'done' });
      showSnack(`Done · next ${when(next.at)}`, () => {
        void store.update(r, { status: r.status });
        void made.then((n) => n && store.update(n, { deleted: 1 }));
      });
    },
    reopen: (r: ItemRow) => change(r, { status: 'open' }, 'Moved back to Today'),
    snooze: (r: ItemRow, at = nextNine()) => change(r, { at, ...UNROLL }, `Snoozed to ${when(at)}`),
    remove: (r: ItemRow) => change(r, { deleted: 1 }, 'Deleted'),
    toTask: (r: ItemRow) => change(r, { status: 'open', ...UNROLL }, 'Moved to Today'),
    due: (r: ItemRow, at: number | null) => change(r, { at, ...UNROLL }, at == null ? 'Due time cleared' : `Due ${when(at)}`),
    edit: (r: ItemRow, patch: Patch) => void store.update(r, patch),
    move: (r: ItemRow, to: Profile) => store.move(r, to).then(() => showSnack(`Moved to ${FILTER_LABEL[to]}`, () => {
      const moved = store.snapshot().items.find((x) => x.profile === to && x.id === r.id);
      void store.move(moved ?? { ...r, profile: to }, r.profile).catch((err) => showSnack(`Not moved: ${errorText(err)}`));
    }), (err) => showSnack(`Not moved: ${errorText(err)}`)),
  };
}

function Swipe({ onRight, onLeft, leftLabel = 'Tomorrow', onDelete, children }: { onRight?: () => void; onLeft?: () => void; leftLabel?: string; onDelete: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const width = useRef(1);
  const deleting = dx < 0 && (!onLeft || -dx > width.current * SWIPE_DELETE);
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  const swiped = useRef(false);
  const reset = () => { from.current = null; moving.current = false; setDx(0); };
  return (
    <div className={`as-swipe${dx > 0 ? ' right' : dx < 0 ? (deleting ? ' left delete' : ' left') : ''}`}>
      <div className="as-swipe-bg"><span><Icon name="check" /> Done</span>{deleting ? <span>Delete <Icon name="trash" /></span> : <span>{leftLabel} <Icon name="clock" /></span>}</div>
      <div
        className="as-swipe-row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: moving.current ? 'none' : undefined }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') { from.current = { x: e.clientX, y: e.clientY }; width.current = e.currentTarget.offsetWidth || 1; } }}
        onPointerMove={(e) => {
          if (!from.current) return;
          if (isDragging()) return reset();
          const mx = e.clientX - from.current.x;
          if (!moving.current) {
            if (Math.abs(e.clientY - from.current.y) > 10 && Math.abs(e.clientY - from.current.y) > Math.abs(mx)) { from.current = null; return; }
            if (Math.abs(mx) < 10) return;
            moving.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setDx(mx > 0 ? (onRight ? mx : 0) : mx);
        }}
        onPointerUp={() => {
          if (moving.current) { swiped.current = true; setTimeout(() => { swiped.current = false; }, 0); }
          const fire = (f?: () => void) => { haptic('tap'); f?.(); };
          if (moving.current && dx > SWIPE) fire(onRight);
          else if (moving.current && deleting && -dx > SWIPE) fire(onDelete);
          else if (moving.current && dx < -SWIPE) fire(onLeft);
          reset();
        }}
        onPointerCancel={reset}
        onClickCapture={(e) => { if (swiped.current) e.stopPropagation(); }}
      >
        {children}
      </div>
    </div>
  );
}

function Check({ row, onDone }: { row: ItemRow; onDone?: () => void }) {
  const act = useActions();
  const [checked, setChecked] = useState(false);
  useEffect(() => setChecked(false), [row.status]);
  const isDone = row.status === 'done';
  if (row.status === 'note') return <span className="as-check note"><Icon name="note" /></span>;
  const tick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone) return act.reopen(row);
    if (checked) return;
    haptic('success');
    setChecked(true);
    setTimeout(() => { act.done(row); onDone?.(); }, 260);
  };
  return (
    <button className={`as-check${checked || isDone ? ' on' : ''}`} title={isDone ? 'Not done' : 'Done'} aria-label={isDone ? 'Not done' : 'Done'} onClick={tick}>
      <Icon name={checked || isDone ? 'pass-filled' : 'circle-large-outline'} />
    </button>
  );
}

const grow = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

// The open task edits in place: title and notes save when they lose focus or the task closes.
function Editor({ row, onClose, onAsk }: { row: ItemRow; onClose: () => void; onAsk: (r: ItemRow) => void }) {
  const act = useActions();
  const { store } = useAssistant();
  const [title, setTitle] = useState(row.title ?? '');
  const [text, setText] = useState(row.text ?? '');
  const saved = useRef({ title: row.title ?? '', text: row.text ?? '' });
  const [snoozing, setSnoozing] = useState(false);
  const [tidying, setTidying] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const src = sourceOf(row);
  const at = atTime(row.at);
  // The phone keyboard covers the lower half, so the field moves into view once it is up.
  const reveal = (e: React.FocusEvent<HTMLTextAreaElement>) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300); };
  const checks = [...text.matchAll(CHECK_RE)].map((m) => ({ done: /x/i.test(m[1]), label: m[2].trim() }));
  // Ticking a checklist line flips its box in the notes and saves at once.
  const toggle = (n: number) => {
    let i = 0;
    const next = text.replace(CHECK_RE, (line, box: string) => (i++ === n ? line.replace(`[${box}]`, /x/i.test(box) ? '[ ]' : '[x]') : line));
    setText(next);
    haptic('tap');
    if (next !== saved.current.text) { saved.current = { ...saved.current, text: next }; act.edit(row, { text: next }); }
  };
  const pending = () => {
    const patch: Patch = {};
    if (title.trim() && title.trim() !== saved.current.title) patch.title = title.trim();
    if (text !== saved.current.text) patch.text = text.trim() ? text : null;
    return patch;
  };
  const save = () => {
    const patch = pending();
    if (!Object.keys(patch).length) return;
    saved.current = { title: patch.title ?? saved.current.title, text };
    act.edit(row, patch);
  };
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => () => latest.current(), []);

  useLayoutEffect(() => { grow(titleRef.current); grow(textRef.current); }, [title, text]);
  // On desktop the title takes focus, so keys go to the task; the phone keeps its keyboard down until a tap.
  useEffect(() => { if (matchMedia('(hover: hover)').matches) titleRef.current?.focus({ preventScroll: true }); }, []);
  // The task grows out of its row instead of popping in.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{ height: '56px', overflow: 'hidden' }, { height: `${el.offsetHeight}px`, overflow: 'hidden' }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }, []);
  useEffect(() => { setTimeout(() => box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 190); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && !(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return;
      const at = document.activeElement;
      if (at && at !== document.body && !box.current?.contains(at)) return;
      onClose();
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row="${row.profile}${row.id}"]`)?.focus());
    };
    // A tap outside closes the task; a tap on another task opens that one instead.
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!box.current?.contains(t) && !t.closest('.as-row, .as-snack')) onClose();
    };
    window.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('pointerdown', down); };
  }, [onClose, row.profile, row.id]);

  const other: Profile = row.profile === 'work' ? 'personal' : 'work';
  const move = () => {
    const patch = pending();
    saved.current = { title, text };
    void act.move({ ...row, ...patch }, other);
  };
  const then = (f: () => void) => () => { save(); f(); onClose(); };
  const timed = row.status === 'open' || row.status === 'suggested' || at != null;
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

  return (
    <div className={`as-edit ${row.profile}`} ref={box} data-no-swipe>
      <Back close={onClose} />
      <div className="as-edit-top">
        <Check row={row} onDone={onClose} />
        <textarea
          ref={titleRef}
          className="as-edit-title"
          rows={1}
          value={title}
          placeholder="Title"
          aria-label="Title"
          enterKeyHint="next"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onFocus={reveal}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); textRef.current?.focus(); } }}
        />
      </div>
      <textarea ref={textRef} className="as-edit-text" rows={1} value={text} placeholder="Notes" aria-label="Notes" onChange={(e) => setText(e.target.value)} onBlur={save} onFocus={reveal} />
      {checks.length > 0 && (
        <div className="as-edit-checks">
          {checks.map((c, i) => (
            <button key={i} className={c.done ? 'on' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(i)}>
              <Icon name={c.done ? 'pass-filled' : 'circle-large-outline'} small /> <span>{c.label || '(empty)'}</span>
            </button>
          ))}
        </div>
      )}
      <div className="as-edit-meta">
        {timed && (
          <span className="as-edit-due">
            <PickDue className={`as-chip${at == null ? ' quiet' : at < Date.now() && row.status === 'open' ? ' late' : ''}`} value={at} onPick={(t) => t !== at && act.due(row, t)}>
              <Icon name="calendar" small /> {at == null ? 'Due' : when(at, Date.now(), true)}
            </PickDue>
            {at != null && <button className="as-chip-x" title="Clear due time" aria-label="Clear due time" onClick={() => act.due(row, null)}><Icon name="close" small /></button>}
          </span>
        )}
        <button className={`as-chip as-prof ${row.profile}`} title={`Move to ${FILTER_LABEL[other]}`} onClick={move}><ProfileDot profile={row.profile} />{FILTER_LABEL[row.profile]}</button>
        {row.meeting_id && <button className="as-chip" onClick={then(() => setView({ list: 'meetings', open: `${row.profile}:${row.meeting_id}` }))}><Icon name="record" small /> Meeting</button>}
        {row.source_url ? (
          <a className="as-chip" href={safeHref(row.source_url)} target="_blank" rel="noreferrer"><Icon name={src.icon} small /> {row.meeting_id ? 'Transcript' : src.label} <Icon name="link-external" small /></a>
        ) : row.source && row.source !== 'capture' && <span className="as-chip static"><Icon name={src.icon} small /> {src.label}</span>}
        {row.people && <span className="as-chip static">{row.people}</span>}
        <span className="as-edit-ago">{ago(row.updated_at, ' ago')}</span>
      </div>
      {snoozing ? (
        <div className="as-edit-actions">
          {at != null && at >= new Date().setHours(24, 0, 0, 0) && <button className="btn" onClick={then(() => act.due(row, null))}>Today</button>}
          {snoozes().map((s) => <button key={s.label} className="btn" onClick={then(() => act.snooze(row, s.at(new Date())))}>{s.label}</button>)}
          <PickTime className="btn" value={at} onPick={(t) => then(() => act.snooze(row, t))()} />
          <button className="icon-btn" title="Back" aria-label="Back" onClick={() => setSnoozing(false)}><Icon name="close" /></button>
        </div>
      ) : (
        <div className="as-edit-actions">
          {row.status === 'note' && <button className="btn" onClick={then(() => act.toTask(row))}>Make task</button>}
          {row.status === 'open' && <button className="btn" onClick={() => setSnoozing(true)}><Icon name="clock" small /> Snooze</button>}
          {row.status === 'open' && <button className="btn" disabled={tidying} onClick={() => void tidy()}><Icon name={tidying ? 'loading' : 'wand'} small spin={tidying} /> Tidy</button>}
          <button className="btn" title="Ask Claude about this task" onClick={then(() => onAsk(row))}><Icon name="sparkle" small /> Ask</button>
          <span className="spacer" />
          <button className="icon-btn as-delete" title="Delete" aria-label="Delete" onClick={then(() => act.remove(row))}><Icon name="trash" /></button>
        </div>
      )}
    </div>
  );
}

// Keys on a focused task: j/k or arrows move, Enter opens, x done, s snooze to the next morning, Delete removes.
function rowKey(e: React.KeyboardEvent<HTMLElement>, row: ItemRow, onOpen: () => void, act: ReturnType<typeof useActions>) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const step = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
  const open = row.status === 'open' || row.status === 'suggested';
  if (step) {
    const rows = [...document.querySelectorAll<HTMLElement>('.tasks [data-row]')];
    rows[rows.indexOf(e.currentTarget) + step]?.focus();
  } else if (e.key === 'Enter') onOpen();
  else if (e.key === 'x' && open) act.done(row);
  else if (e.key === 's' && open) act.snooze(row, nextNine(new Date(Math.max(atTime(row.at) ?? 0, Date.now()))));
  else if (e.key === 'Delete' || e.key === 'Backspace') act.remove(row);
  else return;
  e.preventDefault();
  // When done, snooze or delete takes the row away, focus moves to its neighbour.
  if (!step && e.key !== 'Enter') {
    const rows = [...document.querySelectorAll<HTMLElement>('.tasks [data-row]')];
    const i = rows.indexOf(e.currentTarget);
    const own = e.currentTarget.dataset.row;
    const key = (rows[i + 1] ?? rows[i - 1])?.dataset.row;
    // The store applies the change a moment later; a row that stays (as in search results) keeps focus.
    let tries = 0;
    const move = () => {
      if (!key) return;
      if (!document.querySelector(`[data-row="${own}"]`)) document.querySelector<HTMLElement>(`[data-row="${key}"]`)?.focus();
      else if (++tries < 20) requestAnimationFrame(move);
    };
    requestAnimationFrame(move);
  }
}

// With nothing focused, j or k on Tasks focuses the first task; n, from anywhere outside a field, starts a task for today.
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'j' && e.key !== 'k' && e.key !== 'n') || e.metaKey || e.ctrlKey || e.altKey) return;
  const at = document.activeElement;
  if (e.key === 'n') {
    if ((at && at !== document.body && !at.matches('[data-row]')) || document.querySelector<HTMLElement>('.tasks')?.offsetParent == null) return;
    e.preventDefault();
    window.dispatchEvent(new Event('tasks:add'));
    return;
  }
  if (at && at !== document.body) return;
  const first = document.querySelector<HTMLElement>('.tasks [data-row]');
  if (first?.offsetParent == null) return;
  e.preventDefault();
  first.focus();
});

export function TaskRow({ row, open, onOpen, onClose, onAsk, onGrab, lifted }: { row: ItemRow; open: boolean; onOpen: () => void; onClose: () => void; onAsk: (r: ItemRow) => void; onGrab?: (e: React.PointerEvent) => void; lifted?: boolean }) {
  const act = useActions();
  if (open) return <Editor row={row} onClose={onClose} onAsk={onAsk} />;
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
          {due && <span className={at! < now ? 'as-due late' : 'as-due'}>{due}</span>}
          {est != null && !isDone && <span className="as-chip" title="Estimate">{minutesText(est)}</span>}
          {isRepeat(row.text) && <span title="Repeats"><Icon name="sync" small /></span>}
          {row.rolled_from != null && !isDone && <span>from {new Date(row.rolled_from).toLocaleDateString([], { weekday: 'short' })}</span>}
          {row.source && row.source !== 'capture' && <span className={`as-src ${row.source}`} title={src.label}><Icon name={src.icon} small /></span>}
          {list.total > 0 && <span className={list.done === list.total ? 'as-list-done' : undefined}><Icon name="checklist" small /> {list.done}/{list.total}</span>}
          {row.people && <span className="as-people">{row.people}</span>}
          {!list.total && !row.people && preview && !/^https?:\/\/\S+$/.test(preview) && <span className="as-quote">{preview}</span>}
        </div>
      </div>
    </div>
  );
  if (isNote || isDone) return <Swipe onDelete={() => act.remove(row)}>{body}</Swipe>;
  const later = nextNine(new Date(Math.max(at ?? 0, now)));
  return <Swipe onRight={() => act.done(row)} onLeft={() => act.snooze(row, later)} leftLabel={when(later, now)} onDelete={() => act.remove(row)}>{body}</Swipe>;
}

// A quick add at the end of a day: Enter saves and keeps the field open for the next task.
export function AddTask({ day, today, filter }: { day: number; today: number; filter: Filter }) {
  const { store } = useAssistant();
  const [on, setOn] = useState(false);
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
  if (!on) return <button className="as-add" onClick={() => setOn(true)}><Icon name="add" /> Add task</button>;
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
