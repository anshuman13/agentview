import { atTime, nextNine } from './engine';
import type { Profile } from '../sync';

// Snooze target for a task: the next 09:00 after its due time or now, whichever is later, skipping the weekend for work.
export const snoozeLaterAt = (at: string | number | null, now: number, profile?: Profile) => nextNine(new Date(Math.max(atTime(at) ?? 0, now)), profile);

// Move-to-today target: today at the task's own time of day, or now when that time has passed.
export function todayAt(at: string | number | null, now: number) {
  const from = new Date(atTime(at) ?? now);
  const t = new Date(now).setHours(from.getHours(), from.getMinutes(), 0, 0);
  return t > now ? t : now;
}
