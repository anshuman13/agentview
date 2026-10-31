import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAssistant } from './data';
import { atTime } from './data/engine';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { ago, fitHeight, reveal, safeHref, useOnUnmount } from '../ui/util';
import { copyText, FILTER_LABEL, setView, showSnack } from './view';
import { useActions } from './useActions';
import { clock, PickDue, PickTime } from './time';
import { snoozeText, snoozes } from './AskBar';
import { Back } from '../app/back';
import { haptic } from '../ui/haptic';
import { recentPeople } from './data/points';
import { RaiseWith } from './meetings/Raise';
import { sourceOf } from './taskSource';
import { Check } from './TaskCheck';
import { estimateMin, minutesText, suggestEstimate } from './data/plan';
import { isFocused, startFocus, stopFocus, useFocus } from './focus';
import { GoalPick } from './Goals';
import { caretLine, RelatedStrip } from './Related';
import { cadenceLine, cadenceOf, withRule, type Cadence } from './data/recur';
import { checkItems, toggleCheck } from './taskChecklist';

const dueLabel = (at: number | null) => {
  if (at == null) return 'Date';
  const d = new Date(at);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  const time = d.getHours() || d.getMinutes() ? clock(at) : '';
  if (days === 0 || days === 1) return `${days ? 'Tomorrow' : 'Today'}${time ? ` ${time}` : ''}`;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

// The open task is a page: title and notes save when they lose focus or the task closes.
export function TaskEditor({ row, onClose, onAsk }: { row: ItemRow; onClose: () => void; onAsk: (r: ItemRow) => void }) {
  const act = useActions();
  const { store, snap } = useAssistant();
  const [title, setTitle] = useState(row.title ?? '');
  const [text, setText] = useState(row.text ?? '');
  const saved = useRef({ title: row.title ?? '', text: row.text ?? '' });
  const [typed, setTyped] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const [tidying, setTidying] = useState(false);
  const [logging, setLogging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const src = sourceOf(row);
  const at = atTime(row.at);
  const focused = isFocused(useFocus(), row);
  const suggested = useMemo(() => (row.status === 'open' && estimateMin(title) == null ? suggestEstimate(title, snap.items.filter((r) => !r.deleted && r.profile === row.profile)) : null), [row.status, row.profile, title, snap.items]);
  const checks = checkItems(text);
  const estimate = estimateMin(title);
  const addSubtask = () => {
    const next = `${text}${text && !text.endsWith('\n') ? '\n' : ''}- [ ] `;
    setText(next);
    requestAnimationFrame(() => { const el = textRef.current; if (el) { el.focus(); el.setSelectionRange(next.length, next.length); } });
  };
  // Ticking a checklist line flips its box in the notes and saves at once.
  const toggle = (n: number) => {
    const next = toggleCheck(text, n);
    setText(next);
    haptic('tap');
    if (next !== saved.current.text) { saved.current = { ...saved.current, text: next }; write({ text: next }); }
  };
  const cadence = cadenceOf(text, at);
  const repeat = (c: Cadence) => {
    if (c === 'custom') return;
    const next = withRule(text, c === 'never' ? null : cadenceLine(c, at));
    setText(next);
    if (next !== saved.current.text) { saved.current = { ...saved.current, text: next }; write({ text: next.trim() ? next : null }); }
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
  useOnUnmount(save);
  const addEstimate = (n: number) => {
    const next = `${title.trim()} ~${minutesText(n)}`;
    setTitle(next);
    saved.current = { ...saved.current, title: next };
    write({ title: next });
  };

  const logTime = (n: number) => write({ spent: (Number(row.spent) || 0) + n });

  useLayoutEffect(() => { fitHeight(titleRef.current); fitHeight(textRef.current); }, [title, text]);
  // On desktop the title takes focus, so keys go to the task; the phone keeps its keyboard down until a tap.
  useEffect(() => { if (matchMedia('(hover: hover)').matches) titleRef.current?.focus({ preventScroll: true }); }, []);
  // Closing by key or button puts focus back on the task's row.
  useEffect(() => () => {
    requestAnimationFrame(() => {
      const at = document.activeElement;
      if (!at || at === document.body) document.querySelector<HTMLElement>(`[data-row="${row.profile}${row.id}"]`)?.focus();
    });
  }, [row.profile, row.id]);
  // The more menu closes on an outside tap, and its first item takes focus.
  const actions = useRef<HTMLDivElement>(null);
  const menuOpen = useRef(menu);
  menuOpen.current = menu;
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!menuBox.current?.contains(e.target as Node)) { setMenu(false); setSnoozing(false); } };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [menu]);
  useEffect(() => { if (menu) actions.current?.querySelector<HTMLElement>('button, select')?.focus(); }, [menu, snoozing]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen.current) { setMenu(false); setSnoozing(false); return; }
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

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
    <div className="wk narrow as-page">
      <Back close={onClose} />
      <header className="wk-head">
        <button className="icon-btn" title="Back to tasks" aria-label="Back" onClick={onClose}><Icon name="arrow-left" /></button>
      </header>
      <div className="wk-scroll">
    <div className={`as-edit ${row.profile}`} ref={box} data-no-swipe>
      <div className="as-tt-top">
        <Check row={row} onDone={onClose} />
        {timed && (
          <span className="as-tt-due">
            <PickDue className={`as-tt-chip${at == null ? ' quiet' : at < Date.now() && row.status === 'open' ? ' late' : ''}`} value={at} onPick={(t) => t !== at && act.due(row, t)}>
              <Icon name="calendar" small /> {dueLabel(at)}
            </PickDue>
            {at != null && <button className="as-tt-ico" title="Clear due time" aria-label="Clear due time" onClick={() => act.due(row, null)}><Icon name="close" small /></button>}
          </span>
        )}
        <span className="spacer" />
        <div className="as-tt-more" ref={menuBox}>
          <button className="as-tt-ico" title="More" aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu(!menu); setSnoozing(false); }}><Icon name="kebab-horizontal" /></button>
          {menu && (
            <div className="as-tt-menu" role="menu" ref={actions}>
              {snoozing ? (
                <>
                  <button role="menuitem" onClick={() => setSnoozing(false)}><Icon name="arrow-left" small /> Snooze</button>
                  {at != null && at >= new Date().setHours(24, 0, 0, 0) && <button role="menuitem" onClick={then(() => act.due(row, null))}>Today</button>}
                  {snoozes().map((s) => <button key={s.label} role="menuitem" onClick={then(() => act.snooze(row, s.at(new Date(), row.profile)))}>{snoozeText(s, new Date(), row.profile)}</button>)}
                  <PickTime className="as-tt-menu-pick" value={at} onPick={(t) => then(() => act.snooze(row, t))()} />
                </>
              ) : (
                <>
                  {suggested != null && <button role="menuitem" title="Add this estimate, from similar done tasks" onClick={() => { setMenu(false); addEstimate(suggested); }}><Icon name="add" small /> Add estimate ~{minutesText(suggested)}</button>}
                  {(row.status === 'open' || row.status === 'done') && (
                    <>
                      <button role="menuitem" aria-label="Log time" aria-expanded={logging} onClick={() => setLogging(!logging)}><Icon name="watch" small /> Log time{Number(row.spent) > 0 && ` (${minutesText(Number(row.spent))})`}</button>
                      {logging && <div className="as-tt-menu-chips">{[15, 30, 60].map((n) => <button key={n} className="as-tt-chip" title={`Add ${minutesText(n)} spent`} onClick={() => logTime(n)}>+{minutesText(n)}</button>)}</div>}
                      <div className="as-tt-menu-row"><Icon name="target" small /><GoalPick row={row} onPick={(goal) => act.edit(row, { goal })} /></div>
                    </>
                  )}
                  {row.meeting_id && <button role="menuitem" onClick={then(() => setView({ list: 'meetings', open: `${row.profile}:${row.meeting_id}` }))}><Icon name="record" small /> Open meeting</button>}
                  {row.source_url && <a role="menuitem" href={safeHref(row.source_url)} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}><Icon name={src.icon} small /> {row.meeting_id ? 'Transcript' : src.label}</a>}
                  {row.status === 'note' && <button role="menuitem" onClick={then(() => act.toTask(row))}><Icon name="check" small /> Make task</button>}
                  {row.status === 'open' && <button role="menuitem" onClick={() => setSnoozing(true)}><Icon name="clock" small /> Snooze</button>}
                  {row.status === 'open' && <button role="menuitem" disabled={tidying} onClick={() => { setMenu(false); void tidy(); }}><Icon name={tidying ? 'loading' : 'wand'} small spin={tidying} /> Tidy</button>}
                  {row.draft && <button role="menuitem" onClick={() => { setMenu(false); copyText(row.draft!); }}><Icon name="copy" small /> Copy draft</button>}
                  {row.status === 'open' && <RaiseWith className="as-tt-raise" text={title} profile={row.profile} people={recentPeople(snap.meetings, row.profile, snap.meetings.find((m) => m.profile === row.profile && m.id === row.meeting_id))} />}
                  <button role="menuitem" onClick={() => { setMenu(false); move(); }}><Icon name="arrow-swap" small /> Move to {FILTER_LABEL[other]}</button>
                  <button role="menuitem" onClick={then(() => onAsk(row))}><Icon name="sparkle" small /> Ask Claude</button>
                  <button role="menuitem" className="as-delete" onClick={then(() => act.remove(row))}><Icon name="trash" small /> Delete</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="as-tt-body">
        <div className="as-edit-top">
          <textarea
            ref={titleRef}
            className="as-edit-title"
            rows={1}
            value={title}
            placeholder="Title"
            aria-label="Title"
            enterKeyHint="next"
            onChange={(e) => { setTitle(e.target.value); setTyped((t) => t ?? ''); }}
            onBlur={save}
            onFocus={reveal}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); textRef.current?.focus(); } }}
          />
        </div>
        <textarea ref={textRef} className="as-edit-text" rows={1} value={text} placeholder="Description" aria-label="Description" onChange={(e) => { setText(e.target.value); setTyped(caretLine(e.target)); }} onBlur={save} onFocus={reveal} />
        {typed !== null && <RelatedStrip text={`${title}\n${typed}`} profile={row.profile} skip={row.id} />}
        <div className="as-edit-checks">
          {checks.map((c, i) => (
            <button key={i} role="checkbox" aria-checked={c.done} className={c.done ? 'on' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(i)}>
              <Icon name={c.done ? 'pass-filled' : 'circle-large-outline'} small /> <span>{c.label || '(empty)'}</span>
            </button>
          ))}
          <button className="as-tt-add" onMouseDown={(e) => e.preventDefault()} onClick={addSubtask}><Icon name="add" small /> Add subtask</button>
        </div>
        {(row.people || row.updated_at || estimate != null) && <div className="as-tt-fine">{estimate != null && <span>~{minutesText(estimate)}</span>}{row.people && <span>{row.people}</span>}<span>{ago(row.updated_at, ' ago')}</span></div>}
      </div>
      <div className="as-tt-bar">
        {row.status === 'open' && (
          <label className={`as-tt-ico as-tt-pick${cadence === 'never' ? ' quiet' : ' on'}`} title="Repeat">
            <Icon name="sync" />
            <select value={cadence} aria-label="Repeat" onChange={(e) => repeat(e.target.value as Cadence)}>
              <option value="never">Never repeats</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly{at != null ? ` on ${new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}` : ''}</option>
              <option value="monthly">Monthly{at != null ? ` on the ${new Date(at).getDate()}` : ''}</option>
              {cadence === 'custom' && <option value="custom" disabled>Custom</option>}
            </select>
          </label>
        )}
        <span className="spacer" />
        {row.status === 'open' && (focused
          ? <button className="as-tt-ico on" title="Stop the focus timer" aria-label="Stop" onClick={stopFocus}><Icon name="debug-stop" /></button>
          : <button className="as-tt-ico" title="Start a focus timer" aria-label="Start focus" onClick={() => { save(); startFocus(row); }}><Icon name="play" /></button>)}
      </div>
    </div>
      </div>
    </div>
  );
}
