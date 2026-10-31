import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAssistant } from './data';
import { atTime } from './data/engine';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { Button, Chip, chipClass, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
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
export function TaskEditor({ row, onClose, onAsk }: { row: ItemRow; onClose: () => void; onAsk: (r: ItemRow) => void }) {
  const act = useActions();
  const { store, snap } = useAssistant();
  const [title, setTitle] = useState(row.title ?? '');
  const [text, setText] = useState(row.text ?? '');
  const saved = useRef({ title: row.title ?? '', text: row.text ?? '' });
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
  const moreBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
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
            {tagging && <input autoFocus className="as-tag-input" placeholder="Tag" aria-label="New tag" enterKeyHint="done"
              onKeyDown={(e) => { const v = e.currentTarget.value.replace(/^#/, '').trim().toLowerCase(); if ((e.key === 'Enter' || e.key === ' ') && v) { e.preventDefault(); setTags([...tags, v]); e.currentTarget.value = ''; } else if (e.key === 'Escape') setTagging(false); }}
              onBlur={(e) => { const v = e.currentTarget.value.replace(/^#/, '').trim().toLowerCase(); if (v) setTags([...tags, v]); setTagging(false); }} />}
          </div>
        )}
        <textarea ref={textRef} className="as-edit-text" rows={1} value={text} placeholder="Description" aria-label="Description" onChange={(e) => { setText(e.target.value); setTyped(caretLine(e.target)); }} onBlur={save} onFocus={reveal} />
        {typed !== null && <RelatedStrip text={`${title}\n${typed}`} profile={row.profile} skip={row.id} />}
        <div className="as-edit-checks">
          {checks.map((c, i) => (
            <button key={i} role="checkbox" aria-checked={c.done} className={c.done ? 'on' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(i)}>
              <Icon name={c.done ? 'pass-filled' : 'circle-large-outline'} small /> <span>{c.label || '(empty)'}</span>
            </button>
          ))}
          <Button variant="quiet" size="sm" icon="add" className="as-tt-add" onMouseDown={(e) => e.preventDefault()} onClick={addSubtask}>Add subtask</Button>
        </div>
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
