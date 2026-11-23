import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';
import { stubEnv, unstubAllEnvs } from '../../../testing.js';
import type { ReceiptFields } from '../../../shared/travel.js';

let home: string;
let travel: typeof import('./travel.js');
let reading: () => Promise<ReceiptFields> = async () => ({});

vi.mock('../agent/claude/receipts.js', () => ({
  findTrips: async () => [],
  readable: (mime: string) => mime.startsWith('image/') || mime === 'application/pdf',
  readReceipt: () => reading(),
}));

const upload = (tripId = '') => travel.addReceipt(new Request('http://x', { method: 'POST', body: new Uint8Array([1, 2, 3]) }), tripId, 'taxi.jpg');
const filesDir = () => path.join(home, '.agentview', 'travel', 'files');
const leftovers = () => (fs.existsSync(filesDir()) ? fs.readdirSync(filesDir()) : []);

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-'));
  stubEnv('HOME', home);
  travel = await import('./travel.js');
});

afterAll(() => {
  unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(async () => {
  reading = async () => ({});
  for (const t of (await travel.travelData()).trips) await travel.deleteTrip(t.id);
  for (const f of leftovers()) fs.rmSync(path.join(filesDir(), f));
});

describe('addReceipt', () => {
  it('files an auto-added receipt under the trip that covers its date', async () => {
    const other = await travel.saveTrip({ name: 'Other', from: '2026-05-01', to: '2026-05-03' });
    const lyon = await travel.saveTrip({ name: 'Lyon', from: '2026-03-09', to: '2026-03-12' });
    reading = async () => ({ merchant: 'Taxi Lyon', amount: 40, currency: 'EUR', date: '2026-03-10' });
    const r = await upload();
    expect(r.tripId).toBe(lyon!.id);
    expect(r.tripId).not.toBe(other!.id);
    expect([r.read, r.merchant]).toEqual(['done', 'Taxi Lyon']);
    expect((await travel.travelData()).receipts.map((x) => x.id)).toEqual([r.id]);
  });

  it('still files a receipt whose read failed and keeps its file', async () => {
    const trip = await travel.saveTrip({ name: 'Lyon', from: '2026-03-09', to: '2026-03-12' });
    reading = async () => { throw new Error('timed out'); };
    const r = await upload();
    expect([r.tripId, r.read]).toEqual([trip!.id, 'failed']);
    expect(leftovers()).toEqual([r.file]);
  });

  it('refuses an auto-added receipt without trips and leaves no file', async () => {
    await expect(upload()).rejects.toThrow('Add a trip first');
    expect(leftovers()).toEqual([]);
  });

  it('refuses an unknown trip id', async () => {
    await travel.saveTrip({ name: 'Lyon', from: '2026-03-09', to: '2026-03-12' });
    await expect(upload('nope')).rejects.toMatchObject({ status: 404 });
  });
});
