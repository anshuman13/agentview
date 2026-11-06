import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTaskDraft } from './taskEditor/draft';
import { TagInput } from './taskEditor/TagInput';
import { useAssistant } from './data';
import { atTime } from './data/engine';
import type { AssistantStore } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { Button, Chip, chipClass, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { ago, fitHeight, reveal, safeHref } from '../ui/util';
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
import { caretLine, RelatedStrip, RelatedToTask } from './Related';
import { cadenceLine, cadenceOf, withRule, type Cadence } from './data/recur';
import { addCheck, checkItems, moveCheck, toggleCheck } from './taskChecklist';
import { useDrag } from './drag';
import { Flag, PRIORITIES, REMINDS, tagList } from './AddSheet';

const dueLabel = (at: number | null) => {
  if (at == null) return 'Date';
  const d = new Date(at);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  const time = d.getHours() || d.getMinutes() ? clock(at) : '';
  if (days === 0 || days === 1) return `${days ? 'Tomorrow' : 'Today'}${time ? ` ${time}` : ''}`;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

// The open task is a page: title and notes save when they lose focus or the task closes.
// The reply draft of a Slack ask: Send posts it in the thread as me, Edit changes it first, Skip drops it.
// An ask tagged needs-you by the scan is a decision or something urgent: the draft is a holding line and Send is quiet.
export function Draft({ row, store, onEdit }: { row: ItemRow; store: AssistantStore; onEdit: (draft: string | null) => void }) {
  const mine = tagList(row.tags).includes('needs-you');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.draft ?? '');
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!editing) setText(row.draft ?? ''); }, [row.draft, editing]);
  const keep = () => { setEditing(false); if (text.trim() !== (row.draft ?? '')) { onEdit(text.trim() || null); setEdited(true); } };
  // The text goes with the request, so an edit made a moment ago is what gets posted even before it has synced.
  const send = async () => {
    const changed = editing ? text.trim() !== (row.draft ?? '') : edited;
    if (editing) keep();
    setSending(true);
    setError('');
    try {
      const r = await store.sendReply(row.id, changed, text.trim());
      haptic('success');
      showSnack(r.status === 'answered' ? 'Not sent: someone already answered in the thread' : r.status === 'changed' ? 'Not sent: the thread changed since the draft' : 'Reply sent');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };
  // Skip closes the ask on the hub with no reply, so it leaves the queue and the corrections run sees the dropped draft.
  const skip = async () => {
    setSending(true);
    setError('');
    try {
      await store.skipAsk(row.id);
      haptic('tap');
      showSnack('Skipped, no reply sent');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="as-draft">
      <div className="as-draft-head">{mine ? <><Icon name="person" small /> Needs your decision · holding note</> : 'Reply draft'}</div>
      {editing
        ? <textarea className="as-draft-text" autoFocus rows={3} value={text} aria-label="Reply draft" onChange={(e) => setText(e.target.value)} onBlur={keep} />
        : <div className="as-draft-text">{row.draft}</div>}
      {error && <div className="as-draft-err">Not sent: {error}</div>}
      <div className="as-draft-bar">
        <Button size="sm" variant={mine ? 'quiet' : undefined} icon={sending ? 'loading' : error ? 'refresh' : 'send'} disabled={sending} onMouseDown={(e) => e.preventDefault()} onClick={() => void send()}>{error ? 'Retry' : mine ? 'Send note' : 'Send'}</Button>
        {!editing && <Button variant="quiet" size="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
        <Button variant="quiet" size="sm" icon="close" disabled={sending} onClick={() => void skip()}>Skip</Button>
      </div>
    </div>
  );
}

export function TaskEditor({ row, onClose, onAsk }: { row: ItemRow; onClose: () => void; onAsk: (r: ItemRow) => void }) {
  const act = useActions();
  const { store, snap } = useAssistant();
  const { title, setTitle, text, setText, putTitle, putText, save, write, saving } = useTaskDraft(row, store);
  const [typed, setTyped] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [logging, setLogging] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [tagging, setTagging] = useState(false);
  const flagBtn = useRef<HTMLButtonElement>(null);
  const tags = tagList(row.tags);
  const setTags = (next: string[]) => act.edit(row, { tags: next.length ? [...new Set(next)].join(' ') : null });
  const box = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const src = sourceOf(row);
  const at = atTime(row.at);
  const focused = isFocused(useFocus(), row);
  const suggested = useMemo(() => (row.status === 'open' && estimateMin(title) == null ? suggestEstimate(title, snap.items.filter((r) => !r.deleted && r.profile === row.profile)) : null), [row.status, row.profile, title, snap.items]);
  const checks = checkItems(text);
  const estimate = estimateMin(title);
  const [adding, setAdding] = useState(false);
  const subRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const addSub = () => {
    const el = subRef.current;
    if (!el) return;
    const label = el.value;
    el.value = '';
    if (label.trim()) putText(addCheck(text, label));
  };
  const reorder = (from: number, to: number) => {
    const next = moveCheck(text, from, to);
    if (next === text) return false;
    putText(next);
    return true;
  };
  const { drag, start } = useDrag<number>((from, d) => { if (d.section === 'checks') reorder(from, d.index); }, scroller, 'sub');
  const over = drag?.over?.section === 'checks' ? drag.over.index : -1;
  const gap = <div key="gap" className="as-check-gap" />;
  const subKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
      if (reorder(i, to)) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sub="${to}"]`)?.focus());
    }
  };
  const subInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      if (!e.metaKey && !e.ctrlKey) e.preventDefault();
      addSub();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.currentTarget.value = '';
      setAdding(false);
    }
  };
  // Ticking a checklist line flips its box in the notes and saves at once.
  const toggle = (n: number) => { putText(toggleCheck(text, n)); haptic('tap'); };
  const cadence = cadenceOf(text, at);
  const repeat = (c: Cadence) => { if (c !== 'custom') putText(withRule(text, c === 'never' ? null : cadenceLine(c, at))); };
  const addEstimate = (n: number) => putTitle(`${title.trim()} ~${minutesText(n)}`);

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
  const moreBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const other: Profile = row.profile === 'work' ? 'personal' : 'work';
  // The move waits for the last save, so the phone's store copies the saved title and notes to the other profile.
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
      <div className="wk-scroll" ref={scroller}>
    <div className={`as-edit ${row.profile}`} ref={box} data-no-swipe>
      <div className="as-tt-top">
        <Check row={row} onDone={onClose} />
        {timed && (
          <span className="as-tt-due">
            <PickDue className={chipClass({ late: at != null && at < Date.now() && row.status === 'open' })} value={at} onPick={(t) => t !== at && act.due(row, t)} remind={row.remind ?? null} onRemind={(r) => act.edit(row, { remind: r })}>
              <Icon name="calendar" small /> {dueLabel(at)}{row.remind != null && at != null && <Icon name={row.remind < 0 ? 'bell-slash' : 'bell'} small />}
            </PickDue>
            {at != null && <IconButton icon="close" small label="Clear due time" onClick={() => act.due(row, null)} />}
          </span>
        )}
        <span className="spacer" />
        {row.status !== 'note' && (
          <div className="as-tt-more">
            <button ref={flagBtn} className="icon-btn as-tt-flag" aria-label="Priority" title="Priority" aria-haspopup="menu" aria-expanded={flagging} onClick={() => setFlagging(!flagging)}><Flag priority={row.priority} /></button>
            {flagging && (
              <Menu trigger={flagBtn} className="as-tt-menu" onClose={() => setFlagging(false)}>
                {PRIORITIES.map(([p, l]) => <button key={p} role="menuitemradio" aria-checked={(row.priority ?? 0) === p} className="ui-menu-item as-flag-item" onClick={() => { setFlagging(false); haptic('tap'); act.edit(row, { priority: p || null }); }}><Flag priority={p} /><span>{l} priority</span></button>)}
              </Menu>
            )}
          </div>
        )}
        <div className="as-tt-more">
          <IconButton ref={moreBtn} icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu(!menu); setSnoozing(false); }} />
          {menu && (
            <Menu key={snoozing ? 'snooze' : 'main'} trigger={moreBtn} className="as-tt-menu" onClose={() => { setMenu(false); setSnoozing(false); }}>
              {snoozing ? (
                <>
                  <MenuItem onClick={() => setSnoozing(false)} icon="arrow-left">Snooze</MenuItem>
                  {at != null && at >= new Date().setHours(24, 0, 0, 0) && <MenuItem onClick={then(() => act.due(row, null))}>Today</MenuItem>}
                  {snoozes().map((s) => <MenuItem key={s.label} onClick={then(() => act.snooze(row, s.at(new Date(), row.profile)))}>{snoozeText(s, new Date(), row.profile)}</MenuItem>)}
                  <PickTime className="ui-menu-item" value={at} onPick={(t) => then(() => act.snooze(row, t))()} />
                </>
              ) : (
                <>
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
                  {row.status === 'open' && <MenuItem onClick={() => setSnoozing(true)} icon="clock">Snooze</MenuItem>}
                  {row.status === 'open' && <MenuItem disabled={tidying} onClick={() => { setMenu(false); void tidy(); }} icon={tidying ? 'loading' : 'wand'} spin={tidying}>Tidy</MenuItem>}
                  {row.draft && <MenuItem onClick={() => { setMenu(false); copyText(row.draft!); }} icon="copy">Copy draft</MenuItem>}
                  {row.status === 'open' && <RaiseWith className="ui-menu-item" text={title} profile={row.profile} people={recentPeople(snap.meetings, row.profile, snap.meetings.find((m) => m.profile === row.profile && m.id === row.meeting_id))} />}
                  <MenuItem onClick={() => { setMenu(false); move(); }} icon="arrow-swap">Move to {FILTER_LABEL[other]}</MenuItem>
                  <MenuItem onClick={then(() => onAsk(row))} icon="sparkle">Ask Claude</MenuItem>
                  <MenuItem danger onClick={then(() => act.remove(row))} icon="trash">Delete</MenuItem>
                </>
              )}
            </Menu>
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
        {(tags.length > 0 || tagging) && (
          <div className="as-tags">
            {tags.map((t) => <button key={t} className="as-tag" title={`Remove #${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>#{t} <Icon name="close" small /></button>)}
            {tagging && <TagInput onAdd={(v) => setTags([...tags, v])} onClose={() => setTagging(false)} />}
          </div>
        )}
        <textarea ref={textRef} className="as-edit-text" rows={1} value={text} placeholder="Description" aria-label="Description" onChange={(e) => { setText(e.target.value); setTyped(caretLine(e.target)); }} onBlur={save} onFocus={reveal} />
        {typed !== null && <RelatedStrip text={`${title}\n${typed}`} profile={row.profile} skip={row.id} />}
        <RelatedToTask row={row} />
        <div className="as-edit-checks" data-drop="checks">
          {checks.map((c, i) => (
            <Fragment key={i}>
              {drag && i !== drag.item && over === i - (i > drag.item ? 1 : 0) && gap}
              <div
                role="checkbox"
                aria-checked={c.done}
                tabIndex={0}
                data-sub={i}
                className={[c.done && 'on', drag?.item === i && 'lifted'].filter(Boolean).join(' ') || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={checks.length > 1 ? start(i, String(i), c.label) : undefined}
                onClick={() => toggle(i)}
                onKeyDown={(e) => subKey(e, i)}
              >
                <Icon name={c.done ? 'pass-filled' : 'circle-large-outline'} small /> <span>{c.label || '(empty)'}</span>
              </div>
            </Fragment>
          ))}
          {drag && over === checks.length - 1 && gap}
          {adding && <input ref={subRef} className="as-sub-input" autoFocus aria-label="New subtask" placeholder="Subtask" enterKeyHint="done" onKeyDown={subInputKey} onBlur={() => { addSub(); setAdding(false); }} />}
          <Button variant="quiet" size="sm" icon="add" className="as-tt-add" onMouseDown={(e) => e.preventDefault()} onClick={() => setAdding(true)}>Add subtask</Button>
        </div>
        {row.draft && row.source === 'slack' && (row.status === 'suggested' || row.status === 'open') && <Draft row={row} store={store} onEdit={(draft) => act.edit(row, { draft })} />}
        {(row.people || row.updated_at || estimate != null) && <div className="as-tt-fine">{estimate != null && <span>~{minutesText(estimate)}</span>}{row.people && <span>{row.people}</span>}<span>{ago(row.updated_at, ' ago')}</span></div>}
      </div>
      <div className="as-tt-bar">
        {row.status === 'open' && (
          <label className={`icon-btn icon-btn-md as-tt-pick${cadence === 'never' ? '' : ' on'}`} title="Repeat">
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
        {row.status !== 'note' && <IconButton icon="tag" label="Add tag" title="Add tag" onClick={() => setTagging(true)} />}
        <span className="spacer" />
        {row.status === 'open' && (focused
          ? <IconButton icon="debug-stop" on label="Stop" title="Stop the focus timer" onClick={stopFocus} />
          : <IconButton icon="play" label="Start focus" title="Start a focus timer" onClick={() => { save(); startFocus(row); }} />)}
      </div>
    </div>
      </div>
    </div>
  );
}
