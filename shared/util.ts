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

const LEADING_MENTIONS = /^\s*(?:@\S+\s*)+/;

// A chat's title from its first prompt: the first line, without the mentions it starts with.
export function chatTitle(prompt: string, max = 80) {
  const lines = prompt.split('\n');
  if (!/^\s*@\S/.test(prompt)) return lines[0].slice(0, max);
  for (const line of lines) {
    const rest = line.replace(LEADING_MENTIONS, '').trim();
    if (rest) return rest.slice(0, max);
  }
  const mention = prompt.trim().split(/\s/)[0].slice(1);
  return mention.startsWith('chat:') ? 'Follow-up chat' : `About ${mention.split('/').filter(Boolean).pop()}`;
}
