export const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);
export const dayEnd = (t: number) => new Date(t).setHours(24, 0, 0, 0);

export const dayLabel = (t: number, weekday = false) => new Date(t).toLocaleDateString([], weekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
