import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { applyTripSave, cleanPlan, fileTrip, groupPlan, KIND_ICONS, mergeTrips, nextItem, parseReceipt, parseTrips, receiptsCsv, sortTrips, splitTrips, totalsText, tripState, tripStateText, type PlanItem, type Receipt, type Trip } from './travel';

const fx = JSON.parse(readFileSync(new URL('./fixtures/travel.json', import.meta.url), 'utf8'));

const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe('travel', () => {
  for (const c of fx.totals) it(`totalsText: ${c.name}`, () => expect(totalsText(c.receipts as Receipt[])).toBe(c.expected));
  for (const c of fx.sortTrips) it(`sortTrips: ${c.name}`, () => expect(sortTrips(c.trips as Trip[], c.today).map((t) => t.id)).toEqual(c.expected));
  for (const c of fx.splitTrips) it(`splitTrips: ${c.name}`, () => {
    const out = splitTrips(c.trips as Trip[], c.today);
    expect([out.active.map((t) => t.id), out.archived.map((t) => t.id)]).toEqual([c.active, c.archived]);
  });
  for (const c of fx.tripState) it(`tripState: ${c.name}`, () => {
    expect(tripState(c.trip, c.today)).toBe(c.state);
    expect(tripStateText(c.trip, c.today)).toBe(c.text);
  });
  for (const c of fx.cleanPlan) it(`cleanPlan: ${c.name}`, () => expect(cleanPlan(c.raw, ids())).toEqual(c.expected));
  for (const c of fx.parseTrips) it(`parseTrips: ${c.name}`, () => expect(parseTrips(c.text, ids())).toEqual(c.expected));
  for (const c of fx.mergeTrips) it(`mergeTrips: ${c.name}`, () => {
    const out = mergeTrips({ receipts: [], ...c.data }, c.found, ids(), 5, c.today);
    expect(out.trips).toMatchObject(c.expected.trips);
    expect([out.added, out.updated]).toEqual([c.expected.added, c.expected.updated]);
  });
  for (const c of fx.applyTripSave) it(`applyTripSave: ${c.name}`, () => {
    const out = applyTripSave(c.old as Trip, c.fields, ids());
    expect(out).toMatchObject(c.expected);
    expect(!!out.edited).toBe(c.edited);
  });
  for (const c of fx.groupPlan) it(`groupPlan: ${c.name}`, () => expect(groupPlan(c.plan as PlanItem[]).map((g) => ({ day: g.day, ids: g.items.map((i) => i.id) }))).toEqual(c.expected));
  for (const c of fx.nextItem) it(`nextItem: ${c.name}`, () => expect(nextItem(c.plan as PlanItem[], c.now)?.id ?? null).toBe(c.expected));
  for (const c of fx.fileTrip) it(`fileTrip: ${c.name}`, () => expect(fileTrip(c.trips as Trip[], c.date, c.today)?.id ?? null).toBe(c.expected));
  it('KIND_ICONS', () => expect(KIND_ICONS).toEqual(fx.kindIcons));

  it('cleanPlan caps lengths and items', () => {
    const [i] = cleanPlan([{ day: '2026-11-24', title: 'x'.repeat(200), place: 'p'.repeat(200), ref: 'r'.repeat(200) }], ids());
    expect([i.title.length, i.place.length, i.ref.length]).toEqual([120, 80, 80]);
    expect(cleanPlan(Array.from({ length: 250 }, (_, n) => ({ day: '2026-11-24', title: `t${n}` })), ids())).toHaveLength(200);
  });

  it('parseReceipt keeps valid fields only', () => {
    expect(parseReceipt('Here: {"merchant":" Taxi Oslo ","amount":"845,50","currency":"nok","date":"2026-11-24","category":"taxi"}'))
      .toEqual({ merchant: 'Taxi Oslo', amount: 845.5, currency: 'NOK', date: '2026-11-24', category: 'Taxi' });
    expect(parseReceipt('{"merchant":null,"amount":null,"currency":"kroner","date":"24.11","category":"Snacks"}')).toEqual({});
    expect(parseReceipt('no json')).toEqual({});
  });

  it('receiptsCsv quotes commas and sorts by date', () => {
    const r = (id: string, date: string, merchant: string) => ({ id, date, merchant, category: 'Meal', amount: 10, currency: 'EUR', note: '', name: `${id}.jpg`, addedAt: 0 }) as Receipt;
    expect(receiptsCsv([r('b', '2026-11-25', 'Cafe, Bar'), r('a', '2026-11-24', 'Deli')]).split('\n')).toEqual([
      'Date,Merchant,Category,Amount,Currency,Note,File', '2026-11-24,Deli,Meal,10,EUR,,a.jpg', '2026-11-25,"Cafe, Bar",Meal,10,EUR,,b.jpg', '',
    ]);
  });
});
