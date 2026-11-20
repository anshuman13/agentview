// A claim retired by hand, or live and last dated (`at`) over 90 days ago, is old: it moves to a page's Older section and out of what Claude is given.
// A live claim a chat read (`used_at`) in the last 30 days is not old, however long ago it was dated.
export const RETIRE_AFTER = 90 * 86_400_000;
export const USED_WITHIN = 30 * 86_400_000;

export const isOld = (f: { state?: string | null; at?: number | null; used_at?: number | null }, now = Date.now()) =>
  f.state === 'retired' || (f.state !== 'proposed' && f.at != null && f.at > 0 && now - f.at > RETIRE_AFTER && !(f.used_at != null && f.used_at > 0 && now - f.used_at <= USED_WITHIN));
