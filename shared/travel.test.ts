import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseReceipt, receiptsCsv, sortTrips, totalsText, type Receipt, type Trip } from './travel';

const fx = JSON.parse(readFileSync(new URL('./fixtures/travel.json', import.meta.url), 'utf8'));

describe('travel', () => {
  for (const c of fx.totals) it(`totalsText: ${c.name}`, () => expect(totalsText(c.receipts as Receipt[])).toBe(c.expected));
  for (const c of fx.sortTrips) it(`sortTrips: ${c.name}`, () => expect(sortTrips(c.trips as Trip[], c.today).map((t) => t.id)).toEqual(c.expected));

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
