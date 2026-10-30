import type { Database } from 'bun:sqlite';
import { errText } from '../../shared/util.js';
import { getMeta, setMeta } from './db.js';
import { loop, once } from './once.js';
import { MIN, hm, inWeekHours, workSlotDue } from './time.js';
import { pausedScans } from './claude.js';
import { pushNtfy } from '../../server/src/integrations/notify.js';

export type Counts = Record<string, number>;
export type Scanner = { setUp(): boolean; paused(db: Database): Promise<boolean>; run(db: Database): Promise<Counts> };
export type ScanHealth = { scan: string; ok?: number; counts?: Counts; error?: string; failed?: number; missing?: boolean };

const key = (name: string) => `scan:${name}`;

function note(db: Database, name: string, fields: Partial<ScanHealth>) {
  const prev = JSON.parse(getMeta(db, key(name)) ?? '{}') as ScanHealth;
  setMeta(db, key(name), JSON.stringify({ ...prev, scan: name, ...fields }));
}

// Records the last success with its counts, or the last error, under scan:<name>.
export async function recordScan(db: Database, name: string, fn: () => Promise<Counts>) {
  try {
    const counts = await fn();
    note(db, name, { ok: Date.now(), counts });
    return counts;
  } catch (err) {
    note(db, name, { error: errText(err), failed: Date.now() });
    throw err;
  }
}

// One recorded scan; a call while the same scan runs joins it.
export const runScan = (db: Database, name: string, fn: () => Promise<Counts>) => once(key(name), () => recordScan(db, name, fn));

export function scanHealth(db: Database, missing: string[] = []): ScanHealth[] {
  const rows = db.prepare("SELECT value FROM meta WHERE key LIKE 'scan:%' ORDER BY key").all() as { value: string }[];
  const health = rows.map((r) => JSON.parse(r.value) as ScanHealth).filter((h) => !missing.includes(h.scan));
  return [...health, ...missing.map((scan) => ({ scan, missing: true }))];
}

const BACKOFF = [2, 5, 10].map((m) => m * MIN);

// After a failed run the next try comes 2, 5, then 10 minutes later inside work hours; then only the slots until a success.
export function backoff() {
  let fails = 0;
  let at = 0;
  return {
    due: (now: number) => fails > 0 && fails <= BACKOFF.length && now - at >= BACKOFF[fails - 1] && inWeekHours(now, 7, 19),
    done: (ok: boolean, now: number) => {
      fails = ok ? 0 : fails + 1;
      at = now;
    },
  };
}

// Runs a set-up scan once per slot of `every` from 07:00 to 19:00 on weekdays, sooner after a failure, and skips it while paused.
export function startScan(name: string, s: Scanner, every: number, db: () => Database, tick = MIN) {
  let tried = 0;
  const retry = backoff();
  loop(name, tick, async () => {
    const now = Date.now();
    if (!s.setUp() || !(workSlotDue(tried, every, now) || retry.due(now)) || (await s.paused(db()))) return;
    tried = now;
    try {
      await s.run(db());
      retry.done(true, Date.now());
    } catch (err) {
      retry.done(false, Date.now());
      throw err;
    }
  }, true);
}

const STALL = 45 * MIN;

// Pushes once when a set-up scan has had no success for 45 minutes of work hours; after its next success it can push again.
export async function checkStalls(db: Database, sources: Record<string, () => boolean>, since: number, now = Date.now(), push = pushNtfy) {
  if (!inWeekHours(now, 7, 19)) return;
  const dayStart = new Date(now).setHours(7, 0, 0, 0);
  const health = scanHealth(db);
  const paused = pausedScans(db, now);
  for (const [name, setUp] of Object.entries(sources)) {
    if (!setUp()) continue;
    const h = health.find((x) => x.scan === name);
    const ok = h?.ok ?? 0;
    if (now - Math.max(ok, dayStart, since) < STALL || getMeta(db, `stall:${name}`) === String(ok)) continue;
    const p = paused.find((x) => x.scan === name);
    const reason = p ? `paused: usage limit until ${hm(p.until)}` : h?.error && (h.failed ?? 0) > ok ? h.error : `no success since ${ok ? hm(ok) : 'the hub started'}`;
    if (await push(`${name} scan stalled`, '', reason, '')) setMeta(db, `stall:${name}`, String(ok));
  }
}

export function startStallWatch(db: () => Database, sources: Record<string, () => boolean>) {
  const since = Date.now();
  loop('stall', MIN, () => checkStalls(db(), sources, since));
}
