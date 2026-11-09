export const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);
export const span = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`);
export const inside = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(dir + '/');
export const blockId = (itemId: string) => `block:${itemId}`;
export const isBlock = (meetingId: string) => meetingId.startsWith('block:');
export const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
export function nextClock(hours: number, minutes: number, now: number) {
  const d = new Date(now);
  d.setHours(hours, minutes, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
