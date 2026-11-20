// A claim retired by hand, or live and last dated (`at`) over 90 days ago, is old: it moves to a page's Older section and out of what Claude is given.
export const RETIRE_AFTER = 90 * 86_400_000;

export const isOld = (f: { state?: string | null; at?: number | null }, now = Date.now()) => f.state === 'retired' || (f.state !== 'proposed' && f.at != null && f.at > 0 && now - f.at > RETIRE_AFTER);
