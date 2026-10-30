export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function inWeekHours(now: number, from: number, to: number) {
  const d = new Date(now);
  return d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= from && d.getHours() < to;
}
