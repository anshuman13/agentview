import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAssistant } from './data';
import { atTime } from './data/engine';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { ago, fitHeight, safeHref } from '../ui/util';
import { copyText, FILTER_LABEL, setView, showSnack } from './view';
import { useActions } from './useActions';
import { PickDue, PickTime, when } from './time';
import { snoozes } from './AskBar';
import { Back } from '../app/back';
import { ProfileDot } from './ProfileDot';
import { haptic } from '../ui/haptic';
import { recentPeople } from './data/points';
import { RaiseWith } from './meetings/Raise';
import { sourceOf } from './taskSource';
import { Check } from './TaskCheck';

const CHECK_RE = /^\s*[-*] \[([ xX])\](.*)$/gm;

// The open task edits in place: title and notes save when they lose focus or the task closes.
export function TaskEditor({ row, onClose, onAsk }: { row: ItemRow; onClose: () => void; onAsk: (r: ItemRow) => void }) {
  const act = useActions();
  const { store, snap } = useAssistant();
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
    if (next !== saved.current.text) { saved.current = { ...saved.current, text: next }; write({ text: next }); }
  };
  // The move waits for the last save, so the phone's store copies the saved title and notes to the other profile.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const write = (patch: Patch) => { saving.current = store.update(row, patch); };
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
    write(patch);
  };
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => () => latest.current(), []);

  useLayoutEffect(() => { fitHeight(titleRef.current); fitHeight(textRef.current); }, [title, text]);
  // On desktop the title takes focus, so keys go to the task; the phone keeps its keyboard down until a tap.
  useEffect(() => { if (matchMedia('(hover: hover)').matches) titleRef.current?.focus({ preventScroll: true }); }, []);
  // The task grows out of its row instead of popping in.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{ height: '56px', overflow: 'hidden' }, { height: `${el.offsetHeight}px`, overflow: 'hidden' }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }, []);
  useEffect(() => { setTimeout(() => box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 190); }, []);
  // Closing by key or button puts focus back on the task's row.
  useEffect(() => () => {
    requestAnimationFrame(() => {
      const at = document.activeElement;
      if (!at || at === document.body) document.querySelector<HTMLElement>(`[data-row="${row.profile}${row.id}"]`)?.focus({ preventScroll: true });
    });
  }, [row.profile, row.id]);
  // Opening or leaving the snooze choices keeps focus in the actions.
  const actions = useRef<HTMLDivElement>(null);
  const shown = useRef(snoozing);
  useEffect(() => {
    if (shown.current === snoozing) return;
    shown.current = snoozing;
    if (!box.current?.contains(document.activeElement)) actions.current?.querySelector<HTMLElement>('button, select')?.focus();
  }, [snoozing]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && !(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return;
      const at = document.activeElement;
      if (at && at !== document.body && !box.current?.contains(at)) return;
      onClose();
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
    save();
    void saving.current.then(() => act.move(row, other));
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
            <button key={i} role="checkbox" aria-checked={c.done} className={c.done ? 'on' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(i)}>
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
        <div className="as-edit-actions" ref={actions}>
          {at != null && at >= new Date().setHours(24, 0, 0, 0) && <button className="btn" onClick={then(() => act.due(row, null))}>Today</button>}
          {snoozes().map((s) => <button key={s.label} className="btn" onClick={then(() => act.snooze(row, s.at(new Date())))}>{s.label}</button>)}
          <PickTime className="btn" value={at} onPick={(t) => then(() => act.snooze(row, t))()} />
          <button className="icon-btn" title="Back" aria-label="Back" onClick={() => setSnoozing(false)}><Icon name="close" /></button>
        </div>
      ) : (
        <div className="as-edit-actions" ref={actions}>
          {row.status === 'note' && <button className="btn" onClick={then(() => act.toTask(row))}>Make task</button>}
          {row.status === 'open' && <button className="btn" onClick={() => setSnoozing(true)}><Icon name="clock" small /> Snooze</button>}
          {row.status === 'open' && <button className="btn" disabled={tidying} onClick={() => void tidy()}><Icon name={tidying ? 'loading' : 'wand'} small spin={tidying} /> Tidy</button>}
          {row.draft && <button className="btn" onClick={() => copyText(row.draft!)}><Icon name="copy" small /> Copy draft</button>}
          <button className="btn" title="Ask Claude about this task" onClick={then(() => onAsk(row))}><Icon name="sparkle" small /> Ask</button>
          {row.status === 'open' && <RaiseWith className="btn" text={title} profile={row.profile} people={recentPeople(snap.meetings, row.profile, snap.meetings.find((m) => m.profile === row.profile && m.id === row.meeting_id))} />}
          <span className="spacer" />
          <button className="icon-btn as-delete" title="Delete" aria-label="Delete" onClick={then(() => act.remove(row))}><Icon name="trash" /></button>
        </div>
      )}
    </div>
  );
}
