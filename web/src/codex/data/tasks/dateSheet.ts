import type { Cadence } from './recur';

// The date sheet's choices, shared with Android (CodexDateSheet.kt) through shared/fixtures/date-sheet.json.
export const MORNING = 9;
export const EVENING = 19;

export const REMINDS: [number | null, string][] = [[null, 'On time'], [5, '5 min early'], [30, '30 min early'], [60, '1 hour early'], [1440, '1 day early'], [-1, 'None']];
export const remindLabel = (r: number | null | undefined) => REMINDS.find(([v]) => v === (r ?? null))?.[1] ?? `${r} min early`;
export const REPEATS: [Cadence, string][] = [['never', 'None'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
export const repeatLabel = (c: Cadence) => REPEATS.find(([v]) => v === c)?.[1] ?? 'Custom';

const startOf = (t: number) => new Date(t).setHours(0, 0, 0, 0);

// A day and an optional "HH:MM" make a due time: today without a time is no due time, a later day without one is 09:00.
export const composeDue = (day: number, time: string | null, now = Date.now()) => {
  if (time) { const [h, m] = time.split(':').map(Number); return new Date(day).setHours(h, m, 0, 0); }
  return startOf(day) === startOf(now) ? null : new Date(day).setHours(MORNING, 0, 0, 0);
};

// The quick days: Today, Tomorrow, Next Monday, and This evening before 19:00. A quick day without a time keeps the picked time.
export function quickDays(now: Date): { icon: string; label: string; day: number; time?: string }[] {
  const today = startOf(now.getTime());
  const plus = (n: number) => new Date(today).setDate(now.getDate() + n);
  return [
    { icon: 'calendar', label: 'Today', day: today },
    { icon: 'arrow-right', label: 'Tomorrow', day: plus(1) },
    { icon: 'arrow-circle-right', label: 'Next Monday', day: plus(((8 - now.getDay()) % 7) || 7) },
    ...(now.getHours() < EVENING ? [{ icon: 'color-mode', label: 'This evening', day: today, time: `${EVENING}:00` }] : []),
  ];
}

// The month grid from Monday: blank cells before the 1st, then each day's start.
export function monthCells(month: number): (number | null)[] {
  const m = new Date(month);
  const lead = (m.getDay() + 6) % 7;
  const count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i + 1).getTime())];
}
