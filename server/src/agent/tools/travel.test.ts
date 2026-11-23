import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';
import { stubEnv, unstubAllEnvs } from '../../../../testing.js';

let home: string;
let integrations: typeof import('../../integrations/travel.js');
let travelTool: typeof import('./travel.js').travelTool;

vi.mock('../claude/receipts.js', () => ({ findTrips: async () => [], readable: () => false, readReceipt: async () => ({}) }));

const ctx = { cwd: '/tmp', chatId: null, provider: 'claude' as const, host: { setStatus: () => undefined, goal: () => false, startChat: () => undefined } };
const run = (args: Record<string, unknown>) => travelTool.handler(args as never, ctx as never);
const trip = async (id: string) => (await integrations.travelData()).trips.find((t) => t.id === id)!;

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-tool-'));
  stubEnv('HOME', home);
  integrations = await import('../../integrations/travel.js');
  ({ travelTool } = await import('./travel.js'));
});

afterAll(() => {
  unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const t of (await integrations.travelData()).trips) await integrations.deleteTrip(t.id);
  await integrations.setHome('');
});

describe('travel tool', () => {
  it('lists trips with the home address and returns one trip as text', async () => {
    const t = (await integrations.saveTrip({ name: 'Lyon', from: '2026-12-01', to: '2026-12-03', notes: 'n' }))!;
    expect(await run({ action: 'get' })).toBe(`${t.id} | Lyon | 2026-12-01 to 2026-12-03\nHome: not set`);
    await run({ action: 'home', text: 'Example street 1, City' });
    expect(await run({ action: 'get', trip: t.id })).toBe(`Trip ${t.id}: Lyon, 2026-12-01 to 2026-12-03\nNotes:\nn\nHome: Example street 1, City`);
  });

  it('appends or replaces notes', async () => {
    const t = (await integrations.saveTrip({ name: 'Lyon', from: '', to: '', notes: 'a' }))!;
    expect(await run({ action: 'notes', trip: t.id, text: 'b' })).toBe('Saved.');
    expect((await trip(t.id)).notes).toBe('a\nb');
    await run({ action: 'notes', trip: t.id, text: 'c', replace: true });
    expect((await trip(t.id)).notes).toBe('c');
  });

  it('adds, edits and removes plan items', async () => {
    const t = (await integrations.saveTrip({ name: 'Lyon', from: '', to: '' }))!;
    await run({ action: 'plan_add', trip: t.id, plan: { day: '2026-12-01', title: 'Taxi', start: '06:10' } });
    const [item] = (await trip(t.id)).plan!;
    expect([item.title, item.start, item.kind]).toEqual(['Taxi', '06:10', 'other']);
    await run({ action: 'plan_edit', trip: t.id, item: item.id, plan: { kind: 'taxi' } });
    expect((await trip(t.id)).plan![0]).toMatchObject({ title: 'Taxi', start: '06:10', kind: 'taxi' });
    await run({ action: 'plan_remove', trip: t.id, item: item.id });
    expect((await trip(t.id)).plan).toEqual([]);
  });

  it('adds, ticks and removes checklist items', async () => {
    const t = (await integrations.saveTrip({ name: 'Lyon', from: '', to: '' }))!;
    await run({ action: 'check_add', trip: t.id, text: 'Deck ready' });
    const [c] = (await trip(t.id)).checklist!;
    expect([c.text, c.done]).toEqual(['Deck ready', false]);
    await run({ action: 'check_set', trip: t.id, item: c.id, done: true });
    expect((await trip(t.id)).checklist![0].done).toBe(true);
    await run({ action: 'check_remove', trip: t.id, item: c.id });
    expect((await trip(t.id)).checklist).toEqual([]);
  });

  it('saves and clears the home address', async () => {
    await run({ action: 'home', text: ' Example street 1,\nCity ' });
    expect((await integrations.travelData()).home).toBe('Example street 1, City');
    await run({ action: 'home', text: '' });
    expect((await integrations.travelData()).home).toBe('');
  });

  it('returns an error line for unknown ids and missing fields', async () => {
    const t = (await integrations.saveTrip({ name: 'Lyon', from: '', to: '' }))!;
    expect(await run({ action: 'get', trip: 'nope' })).toBe('No trip nope.');
    expect(await run({ action: 'notes', text: 'x' })).toBe('No trip (trip missing).');
    expect(await run({ action: 'check_set', trip: t.id, item: 'nope', done: true })).toBe('No item nope on this trip.');
    expect(await run({ action: 'plan_remove', trip: t.id, item: 'nope' })).toBe('No item nope on this trip.');
    expect(await run({ action: 'plan_add', trip: t.id, plan: { title: 'x' } })).toBe('plan needs a title and a day as YYYY-MM-DD.');
    expect(await run({ action: 'check_add', trip: t.id })).toBe('text is required.');
  });

  it('sets edited on a calendar trip that really changes', async () => {
    await integrations.saveTrip({ name: 'Lyon', from: '2026-12-01', to: '2026-12-03' });
    const id = (await integrations.travelData()).trips[0].id;
    const raw = path.join(home, '.agentview', 'travel', 'travel.json');
    const data = JSON.parse(fs.readFileSync(raw, 'utf8'));
    data.trips[0].calendar = true;
    fs.writeFileSync(raw, JSON.stringify(data));
    await run({ action: 'notes', trip: id, text: 'same' });
    expect((await trip(id)).edited).toBe(true);
  });
});
