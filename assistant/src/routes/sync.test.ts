import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { openDb } from '../core/db.js';
import { SCANNERS } from './scan.js';
import { resetScannerCache, syncRoutes, unconfiguredScanners } from './sync.js';
import { Reply } from './http.js';

type Fake = (typeof SCANNERS)[string] & { calls: number };

const make = (ready: () => boolean) => {
  const s = { calls: 0, setUp: () => (s.calls++, ready()) };
  return s as unknown as Fake;
};

describe('unconfiguredScanners', () => {
  beforeEach(resetScannerCache);

  it('calls each setUp once per 60 s and shows a changed result only after expiry', () => {
    let on = false;
    const a = make(() => on);
    const b = make(() => true);
    const scanners = { a, b };
    expect(unconfiguredScanners(1000, scanners)).toEqual(['a']);
    on = true;
    expect(unconfiguredScanners(30_000, scanners)).toEqual(['a']);
    expect([a.calls, b.calls]).toEqual([1, 1]);
    expect(unconfiguredScanners(61_000, scanners)).toEqual([]);
    expect([a.calls, b.calls]).toEqual([2, 2]);
  });

  it('does not cache a setUp that throws', () => {
    let fail = true;
    const a = make(() => {
      if (fail) throw new Error('boom');
      return true;
    });
    expect(() => unconfiguredScanners(1000, { a })).toThrow('boom');
    fail = false;
    expect(unconfiguredScanners(1001, { a })).toEqual([]);
    expect(a.calls).toBe(2);
  });
});

describe('poll health fields', () => {
  const saved = { ...SCANNERS };
  let setUps: number;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    resetScannerCache();
    setUps = 0;
    db = openDb(':memory:');
    for (const k of Object.keys(SCANNERS)) SCANNERS[k] = { ...saved[k], setUp: () => (setUps++, false) };
  });
  afterEach(() => Object.assign(SCANNERS, saved));

  const call = async (route: string, since: number, opts: { changes?: unknown[]; full?: unknown; query?: string } = {}) => {
    const res = new Reply();
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ since, changes: opts.changes, full: opts.full }) });
    const url = new URL(`http://x/changes?since=${since}${opts.query ?? ''}`);
    await syncRoutes[route]({ req, res, url, getDb: () => db, device: 'd' } as never);
    return (await res.response).json() as any;
  };
  const row = { table: 'items', id: 'a', profile: 'work', updated_at: 1, fields: { title: 'A' }, field_times: { title: 1 } };

  it('omits paused and scans on an idle poll without running setUp', async () => {
    const head = (await call('GET /changes', 0)).version;
    setUps = 0;
    for (const r of [await call('GET /changes', head), await call('POST /sync', head, { changes: [] })]) {
      expect(r).not.toHaveProperty('paused');
      expect(r).not.toHaveProperty('scans');
    }
    expect(setUps).toBe(0);
  });

  it('carries both fields when behind, on a rejected-only batch, and on a full poll', async () => {
    await call('POST /sync', 0, { changes: [row] });
    const head = (await call('GET /changes', 0)).version;
    const bad = { ...row, table: 'nope' };
    const replies = [await call('GET /changes', 0), await call('POST /sync', head, { changes: [bad] }), await call('GET /changes', head, { query: '&full=1' }), await call('POST /sync', head, { changes: [], full: true })];
    for (const r of replies) {
      expect(r.paused).toBeArray();
      expect(r.scans).toBeArray();
    }
    expect(await call('POST /sync', head, { changes: [], full: 'yes' })).not.toHaveProperty('scans');
  });
});
