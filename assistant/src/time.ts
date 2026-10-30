export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function inWeekHours(now: number, from: number, to: number) {
  const d = new Date(now);
  return d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= from && d.getHours() < to;
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
export const localDate = (t: number) => {
  const d = new Date(t);
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A time the model wrote: "YYYY-MM-DD" (09:00 local), "YYYY-MM-DDTHH:MM" in local time, or a full date string.
export function parseWhen(s: string | null | undefined) {
  const v = s?.trim() ?? '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(v);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0).getTime();
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
}
