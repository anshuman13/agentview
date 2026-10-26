import { useEffect, useRef } from 'react';
import { SNOOZES } from './data/engine';
import { Icon } from '../ui/Icon';

export function when(at: number, now = Date.now()) {
  const d = new Date(at);
  const today = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days === -1) return `yesterday ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// A button that opens the system date and time picker.
export function PickTime({ className, value, onPick, label = 'Pick time', title }: { className: string; value?: number | null; onPick: (at: number) => void; label?: React.ReactNode; title?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  // React's onChange fires on every input event; the native change event fires once the picker is confirmed.
  useEffect(() => {
    const el = input.current!;
    const change = () => { const t = new Date(el.value).getTime(); if (Number.isFinite(t)) pick.current(t); };
    el.addEventListener('change', change);
    return () => el.removeEventListener('change', change);
  }, []);
  const open = () => {
    const el = input.current;
    if (!el) return;
    el.value = localInput(value ?? SNOOZES[0].at(new Date()));
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  return (
    <span className="as-pick">
      <button className={className} title={title} onClick={(e) => { e.stopPropagation(); open(); }}><Icon name="calendar" small /> {label}</button>
      <input ref={input} type="datetime-local" tabIndex={-1} aria-hidden />
    </span>
  );
}
