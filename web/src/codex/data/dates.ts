export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);
export const dayEnd = (t: number) => new Date(t).setHours(24, 0, 0, 0);
export const weekStart = (now: number) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
};

export const dayLabel = (t: number, weekday = false) => new Date(t).toLocaleDateString([], weekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
