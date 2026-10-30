export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function inWeekHours(now: number, from: number, to: number) {
  const d = new Date(now);
  return d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= from && d.getHours() < to;
}

// True once per slot of `every` ms from 07:00 to 19:00 on weekdays, when the last try came before the current slot.
export function workSlotDue(last: number, every: number, now: number) {
  return inWeekHours(now, 7, 19) && last < slotStart(now, every);
}

// The start of the slot of `every` ms (a divisor of an hour) that holds t, on the local clock, so half hours start at :00 and :30 in any time zone.
export function slotStart(t: number, every: number) {
  const d = new Date(t);
  return t - ((d.getMinutes() * MIN) % every) - d.getSeconds() * 1000 - d.getMilliseconds();
}

// Moves n workdays (Monday to Friday) forward, or back when n is negative, keeping the time of day.
export function addWorkdays(t: number, n: number) {
  const d = new Date(t);
  for (let left = Math.abs(n); left > 0; ) {
    d.setDate(d.getDate() + Math.sign(n));
    if (d.getDay() >= 1 && d.getDay() <= 5) left--;
  }
  return d.getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (t: number, sep = '-') => {
  const d = new Date(t);
  return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join(sep);
};
export const localDate = (t: number) => `${new Date(t).toLocaleDateString('en-US', { weekday: 'long' })} ${ymd(t)}`;

// A time the model wrote: "YYYY-MM-DD" (09:00 local), "YYYY-MM-DDTHH:MM" in local time, or a full date string.
export function parseWhen(s: string | null | undefined) {
  const v = s?.trim() ?? '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(v);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0).getTime();
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
}
