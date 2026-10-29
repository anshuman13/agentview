import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAssistant } from './data';
import { atTime, errorText, nextNine } from './data/engine';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { ago } from '../ui/util';
import { FILTER_LABEL, setView, showSnack } from './view';
import { PickDue, PickTime, when } from './time';
import { snoozes } from './AskBar';
import { isDragging } from './drag';
import { Back } from '../app/back';
import { ProfileDot } from './ProfileDot';
import { haptic } from '../ui/haptic';

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
const sourceOf = (r: ItemRow) => SOURCES[r.source ?? 'capture'] ?? { icon: 'circle-small', label: r.source ?? '' };

const SWIPE = 80;
// A left swipe past this share of the row deletes instead of snoozing.
const SWIPE_DELETE = 0.55;
const DAY = 86400_000;

const firstLine = (s: string | null) => s?.split('\n').find((l) => l.trim())?.trim() ?? '';

export const UNROLL = { rolls: null, rolled_from: null };

export function useActions() {
  const { store } = useAssistant();
  const change = (r: ItemRow, patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]])) as Patch;
    void store.update(r, patch);
    showSnack(text, () => void store.update(r, before));
  };
  return {
    done: (r: ItemRow) => change(r, { status: 'done' }, 'Done'),
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

function Swipe({ onRight, onLeft, onDelete, children }: { onRight?: () => void; onLeft?: () => void; onDelete: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const width = useRef(1);
  const deleting = dx < 0 && (!onLeft || -dx > width.current * SWIPE_DELETE);
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  const swiped = useRef(false);
  const reset = () => { from.current = null; moving.current = false; setDx(0); };
  return (
    <div className={`as-swipe${dx > 0 ? ' right' : dx < 0 ? (deleting ? ' left delete' : ' left') : ''}`}>
      <div className="as-swipe-bg"><span><Icon name="check" /> Done</span>{deleting ? <span>Delete <Icon name="trash" /></span> : <span>Tomorrow <Icon name="clock" /></span>}</div>
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
  const isDone = row.status === 'done';
  if (row.status === 'note') return <span className="as-check note"><Icon name="note" /></span>;
  const tick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone) return act.reopen(row);
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
  useEffect(() => { box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // A tap outside closes the task; a tap on another task opens that one instead.
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!box.current?.contains(t) && !t.closest('.as-row, .as-snack')) onClose();
    };
    window.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('pointerdown', down); };
  }, [onClose]);

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
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); textRef.current?.focus(); } }}
        />
      </div>
      <textarea ref={textRef} className="as-edit-text" rows={1} value={text} placeholder="Notes" aria-label="Notes" onChange={(e) => setText(e.target.value)} onBlur={save} />
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
          <a className="as-chip" href={row.source_url} target="_blank" rel="noreferrer"><Icon name={src.icon} small /> {row.meeting_id ? 'Transcript' : src.label} <Icon name="link-external" small /></a>
        ) : row.source && row.source !== 'capture' && <span className="as-chip static"><Icon name={src.icon} small /> {src.label}</span>}
        {row.people && <span className="as-chip static">{row.people}</span>}
        <span className="as-edit-ago">{ago(row.updated_at, ' ago')}</span>
      </div>
      {snoozing ? (
        <div className="as-edit-actions">
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
  const body = (
    <div className={`as-row ${row.profile}${isDone ? ' checked' : ''}${lifted ? ' lifted' : ''}`} data-row={row.profile + row.id} onPointerDown={onGrab} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpen()}>
      <Check row={row} />
      <div className="as-body">
        <div className="as-title"><ProfileDot profile={row.profile} />{row.title || '(Untitled)'}</div>
        <div className="as-ctx">
          {due && <span className={at! < now ? 'as-due late' : 'as-due'}>{due}</span>}
          {row.rolled_from != null && !isDone && <span>from {new Date(row.rolled_from).toLocaleDateString([], { weekday: 'short' })}</span>}
          {row.source && row.source !== 'capture' && <span className={`as-src ${row.source}`}><Icon name={src.icon} small /> {src.label}</span>}
          {row.people && <span className="as-people">{row.people}</span>}
          {row.text && <span className="as-quote">{firstLine(row.text)}</span>}
        </div>
      </div>
    </div>
  );
  if (isNote || isDone) return <Swipe onDelete={() => act.remove(row)}>{body}</Swipe>;
  return <Swipe onRight={() => act.done(row)} onLeft={() => act.snooze(row, nextNine(new Date(Math.max(at ?? 0, now))))} onDelete={() => act.remove(row)}>{body}</Swipe>;
}
