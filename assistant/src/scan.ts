import type { Database } from 'bun:sqlite';
import { errText } from '../../shared/util.js';
import { getMeta, setMeta } from './db.js';
import { once } from './once.js';

export type Counts = Record<string, number>;
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
