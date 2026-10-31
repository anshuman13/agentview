import { useRef, useState } from 'react';
import { useAssistant } from './data';
import { errorText, parseWhen, stripWhen } from './data/engine';
import { cadenceLine, parseRepeat, withRule, type Cadence } from './data/recur';
import { pad } from './data/dates';
import type { Profile } from './data/sync';
import { Back } from '../app/back';
import { Icon } from '../ui/Icon';
import { haptic } from '../ui/haptic';
import { readFlag, saveFlag } from '../ui/util';
import { useSheetDrag } from '../ui/useSheetDrag';
import { FILTER_LABEL, showSnack, type Filter } from './view';
import { ProfileDot } from './ProfileDot';
import { EVENING, MORNING, when } from './time';

type Pick = { at: number | null; cadence: Cadence };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const startOf = (t: number) => new Date(t).setHours(0, 0, 0, 0);
const hasTime = (at: number | null) => at != null && (new Date(at).getHours() !== MORNING || new Date(at).getMinutes() !== 0);

// A day and an optional time make a due time: today without a time is no due time, a later day without one is 09:00.
const compose = (day: number, time: string | null) => {
  if (time) { const [h, m] = time.split(':').map(Number); return new Date(day).setHours(h, m, 0, 0); }
  return day === startOf(Date.now()) ? null : new Date(day).setHours(MORNING, 0, 0, 0);
};

const REPEATS: [Cadence, string][] = [['never', 'None'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];

// TickTick's date sheet: quick days, a month, then time and repeat rows.
export function DateSheet({ value, cadence, onDone, onClose }: { value: Pick; cadence?: boolean; onDone: (p: Pick) => void; onClose: () => void }) {
  const sheet = useSheetDrag(true, onClose);
  const today = startOf(Date.now());
  const [day, setDay] = useState(value.at == null ? today : startOf(value.at));
  const [time, setTime] = useState<string | null>(value.at != null && hasTime(value.at) ? `${pad(new Date(value.at).getHours())}:${pad(new Date(value.at).getMinutes())}` : null);
  const [repeat, setRepeat] = useState(value.cadence);
  const [month, setMonth] = useState(() => { const d = new Date(day); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); });
  const timeInput = useRef<HTMLInputElement>(null);
  const done = (d = day, t = time) => { haptic('tap'); onDone({ at: compose(d, t), cadence: repeat }); onClose(); };
  const now = new Date();
  const monday = new Date(today).setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  const quick: [string, string, () => void][] = [
    ['calendar', 'Today', () => done(today)],
    ['arrow-right', 'Tomorrow', () => done(new Date(today).setDate(now.getDate() + 1))],
    ['arrow-circle-right', 'Next Monday', () => done(monday)],
    ...(now.getHours() < EVENING ? [['color-mode', 'This evening', () => done(today, `${EVENING}:00`)] as [string, string, () => void]] : []),
  ];
  const m = new Date(month);
  const lead = (m.getDay() + 6) % 7;
  const count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i + 1).getTime())];
  const shift = (n: number) => setMonth(new Date(m.getFullYear(), m.getMonth() + n, 1).getTime());
  return (
    <div className="as-sheet-overlay" ref={sheet.overlay} onClick={sheet.close}>
      <Back close={onClose} />
      <div className="as-sheet as-date" ref={sheet.sheet} role="dialog" aria-label="Date" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" {...sheet.handle} />
        <div className="as-date-head">
          <button className="icon-btn" aria-label="Cancel" onClick={sheet.close}><Icon name="close" /></button>
          <span>Date</span>
          <button className="icon-btn as-date-ok" aria-label="Done" onClick={() => done()}><Icon name="check" /></button>
        </div>
        <div className="as-date-quick">
          {quick.map(([icon, label, f]) => <button key={label} onClick={f}><Icon name={icon} /><span>{label}</span></button>)}
        </div>
        <div className="as-date-month">
          <span>{m.toLocaleDateString([], { month: 'long', year: m.getFullYear() === now.getFullYear() ? undefined : 'numeric' })}</span>
          <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="chevron-left" /></button>
          <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><Icon name="chevron-right" /></button>
        </div>
        <div className="as-date-grid" role="grid">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="as-date-dow">{d}</span>)}
          {cells.map((t, i) => t == null ? <span key={i} /> : (
            <button key={i} className={`${t === day ? 'on' : ''}${t === today ? ' today' : ''}${t < today ? ' past' : ''}`} aria-pressed={t === day} aria-label={new Date(t).toDateString()} onClick={() => { haptic('tap'); setDay(t); }}>{new Date(t).getDate()}</button>
          ))}
        </div>
        <div className="as-date-rows">
          <label className="as-date-row">
            <Icon name="clock" /><span>Time</span>
            <em>{time ?? 'None'}</em>
            {time ? <button className="icon-btn" aria-label="Clear time" onClick={(e) => { e.preventDefault(); setTime(null); }}><Icon name="close" small /></button> : <Icon name="chevron-right" small />}
            <input ref={timeInput} type="time" value={time ?? ''} onChange={(e) => setTime(e.target.value || null)} onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* opens on focus */ } }} />
          </label>
          {cadence && (
            <label className="as-date-row">
              <Icon name="sync" /><span>Repeat</span>
              <em>{REPEATS.find(([c]) => c === repeat)?.[1] ?? 'Custom'}</em><Icon name="chevron-right" small />
              <select value={repeat} aria-label="Repeat" onChange={(e) => setRepeat(e.target.value as Cadence)}>
                {REPEATS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

// TickTick's quick add: a bottom sheet with title, description, date and list, and a send button.
export function AddSheet({ filter, onClose }: { filter: Filter; onClose: () => void }) {
  const { store } = useAssistant();
  const sheet = useSheetDrag(true, onClose);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [pick, setPick] = useState<Pick | null>(null);
  const [dating, setDating] = useState(false);
  const [picked, setPicked] = useState<Profile | null>(null);
  const busy = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const profile: Profile = filter !== 'all' ? filter : picked ?? (readFlag('assistant-personal', false) ? 'personal' : 'work');
  const typed = title.trim();
  const add = async () => {
    if (!typed || busy.current) return;
    busy.current = true;
    const rep = pick ? null : parseRepeat(typed);
    const w = pick || rep ? null : parseWhen(typed);
    const at = pick ? pick.at : rep?.at ?? w?.at ?? null;
    const name = rep ? rep.title : stripWhen(typed, w) || typed;
    const rule = pick && pick.cadence !== 'never' && pick.cadence !== 'custom' ? cadenceLine(pick.cadence, at) : null;
    const body = rep ? withRule(notes.trim(), rep.text) : withRule(notes.trim(), rule);
    try {
      const row = await store.capture(body ? `${name}\n${body}` : name, 'task', profile, at);
      saveFlag('assistant-personal', profile === 'personal');
      haptic('tap');
      setTitle(''); setNotes(''); setPick(null);
      showSnack(at != null ? `Task · ${when(at)}` : 'Task · No time', () => void store.update(row, { deleted: 1 }));
      field.current?.focus();
    } catch (err) {
      showSnack(`Not saved: ${errorText(err)}`);
    } finally {
      busy.current = false;
    }
  };
  return (
    <>
      <div className="as-sheet-overlay" ref={sheet.overlay} onClick={sheet.close}>
        {!dating && <Back close={onClose} />}
        <div className="as-sheet as-quick" ref={sheet.sheet} role="dialog" aria-label="New task" onClick={(e) => e.stopPropagation()} data-no-swipe>
          <input ref={field} autoFocus className="as-quick-title" value={title} placeholder="What would you like to do?" aria-label="New task" enterKeyHint="send"
            onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add(); }} />
          <input className="as-quick-notes" value={notes} placeholder="Description" aria-label="Description" onChange={(e) => setNotes(e.target.value)} />
          <div className="as-quick-bar">
            <button className={`as-quick-tool${pick ? ' on' : ''}`} aria-label="Date" onMouseDown={(e) => e.preventDefault()} onClick={() => setDating(true)}>
              <Icon name="calendar" />{pick && <span>{pick.at == null ? 'Today' : cap(when(pick.at))}</span>}{pick && pick.cadence !== 'never' && <Icon name="sync" small />}
            </button>
            {filter === 'all' && (
              <button className="as-quick-tool" aria-label={`List: ${FILTER_LABEL[profile]}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setPicked(profile === 'work' ? 'personal' : 'work')}>
                <ProfileDot profile={profile} /><span>{FILTER_LABEL[profile]}</span>
              </button>
            )}
            <span className="spacer" />
            <button className="as-quick-send" aria-label="Add task" disabled={!typed} onMouseDown={(e) => e.preventDefault()} onClick={() => void add()}><Icon name="send" /></button>
          </div>
        </div>
      </div>
      {dating && <DateSheet value={pick ?? { at: null, cadence: 'never' }} cadence onDone={setPick} onClose={() => { setDating(false); field.current?.focus(); }} />}
    </>
  );
}
