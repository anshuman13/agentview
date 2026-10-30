export const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

export const dayLabel = (t: number, weekday = false) => new Date(t).toLocaleDateString([], weekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
