import { useEffect, useRef, useState } from 'react';
import { DateSheet } from './AddSheet';
import { Icon } from '../ui/Icon';
import { dayLabel, pad, ymd } from './data/dates';

// Times are picked as a part of the day, not a minute.
export const MORNING = 9;
export const EVENING = 19;
const slot = (now: Date, days: number, hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour).getTime();

// Mirrors the hub's quiet hours (assistant/src/remind.ts): no reminders from 17:00 to 08:00.
export const muted = (at: number) => { const h = new Date(at).getHours(); return h >= 17 || h < 8; };

export function slots(now = new Date()): { label: string; at: number }[] {
  const h = now.getHours();
  return [
    ...(h < MORNING ? [{ label: 'This morning', at: slot(now, 0, MORNING) }] : []),
    ...(h < EVENING ? [{ label: 'This evening', at: slot(now, 0, EVENING) }] : []),
    { label: 'Tomorrow morning', at: slot(now, 1, MORNING) },
    { label: 'Tomorrow evening', at: slot(now, 1, EVENING) },
    { label: 'Next week', at: slot(now, ((8 - now.getDay()) % 7) || 7, MORNING) },
  ];
}

export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function when(at: number, now = Date.now(), withTime = false) {
  const d = new Date(at);
  const today = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  const part = d.getMinutes() === 0 && d.getHours() === MORNING ? 'morning' : d.getMinutes() === 0 && d.getHours() === EVENING ? 'evening' : null;
  const time = part ?? clock(at);
  if (days === 0) return part ? `this ${part}` : time;
  if (days === 1) return `tomorrow ${time}`;
  if (days === -1) return `yesterday ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  const date = dayLabel(at);
  return withTime ? `${date} ${time}` : date;
}


// A menu of morning and evening slots, plus a day picker that lands on that day's morning.
export function PickTime({ className, value, onPick, label = 'Pick time', title }: { className: string; value?: number | null; onPick: (at: number) => void; label?: React.ReactNode; title?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  // React's onChange fires on every input event; the native change event fires once the picker is confirmed.
  // Confirming a pre-filled date fires no change, so the input is pre-filled only when the time is already that day's
  // morning, the result of picking it. Otherwise it starts empty and any confirmed day counts.
  useEffect(() => {
    const el = input.current!;
    const change = () => { const [y, m, d] = el.value.split('-').map(Number); if (y && m && d) pick.current(new Date(y, m - 1, d, MORNING).getTime()); };
    el.addEventListener('change', change);
    return () => el.removeEventListener('change', change);
  }, []);
  const choose = (v: string) => {
    if (v !== 'day') return v && onPick(Number(v));
    const el = input.current;
    if (!el) return;
    const d = new Date(value ?? NaN);
    el.value = value === new Date(d.getFullYear(), d.getMonth(), d.getDate(), MORNING).getTime() ? ymd(value) : '';
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  return (
    <span className="as-pick" onClick={(e) => e.stopPropagation()}>
      <button className={className} title={title} tabIndex={-1}><Icon name="calendar" small /> {label}</button>
      <select value="" title={title} aria-label={title ?? 'Pick time'} onChange={(e) => choose(e.target.value)}>
        <option value="" disabled>{title ?? 'Pick time'}</option>
        {slots().map((s) => <option key={s.label} value={s.at}>{s.label}</option>)}
        <option value="day">Pick a day…</option>
      </select>
      <input ref={input} type="date" tabIndex={-1} aria-hidden />
    </span>
  );
}

const localDateTime = (t: number) => { const d = new Date(t); return `${ymd(t)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Text that opens the device's date and time picker; clearing the picker clears the time.
export function PickDue({ className, value, onPick, remind, onRemind, children }: { className?: string; value: number | null; onPick: (at: number | null) => void; remind?: number | null; onRemind?: (r: number | null) => void; children: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = input.current!;
    const change = () => {
      const t = el.value ? new Date(el.value).getTime() : null;
      if (t == null || Number.isFinite(t)) pick.current(t);
    };
    el.addEventListener('change', change);
    return () => el.removeEventListener('change', change);
  }, []);
  const [sheet, setSheet] = useState(false);
  const open = () => {
    if (matchMedia('(pointer: coarse)').matches) return setSheet(true);
    const el = input.current!;
    el.value = value == null ? '' : localDateTime(value);
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  return (
    <span className={`as-pick ${className ?? ''}`}>
      <button type="button" onClick={open}>{children}</button>
      <input ref={input} type="datetime-local" tabIndex={-1} aria-hidden />
      {sheet && <DateSheet value={{ at: value, cadence: 'never', remind }} reminder={!!onRemind} onDone={(p) => { if (p.at !== value) onPick(p.at); if (onRemind && (p.remind ?? null) !== (remind ?? null)) onRemind(p.remind ?? null); }} onClose={() => setSheet(false)} />}
    </span>
  );
}
