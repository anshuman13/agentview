import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mergeTrips, parseReceipt, parseTrips, receiptsCsv, sortTrips, totalsText, type Receipt, type Trip } from './travel';

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

  it('parseTrips keeps trips with a name and dates', () => {
    expect(parseTrips('Trips: [{"name":"Lyon offsite","from":"2026-12-01","to":"2026-11-30","notes":" AF 1 "},{"name":"","from":"2026-12-05"},{"name":"X","from":"soon"}]'))
      .toEqual([{ name: 'Lyon offsite', from: '2026-12-01', to: '2026-12-01', notes: 'AF 1' }]);
    expect(parseTrips('none')).toEqual([]);
  });

  it('mergeTrips follows the calendar but keeps what the user did', () => {
    const t = (id: string, from: string, to: string, more: Partial<Trip> = {}) => ({ id, name: id, from, to, notes: '', createdAt: 0, ...more }) as Trip;
    const d = {
      trips: [t('cal', '2026-12-01', '2026-12-02', { calendar: true }), t('mine', '2026-12-10', '2026-12-11'), t('edited', '2026-12-20', '2026-12-21', { calendar: true, edited: true })],
      receipts: [], dismissed: [{ from: '2026-12-15', to: '2026-12-16' }],
    };
    const found = [
      { name: 'Lyon', from: '2026-12-01', to: '2026-12-03', notes: 'Flight' },
      { name: 'Turin', from: '2026-12-11', to: '2026-12-12', notes: 'Train' },
      { name: 'Gone', from: '2026-12-16', to: '2026-12-16', notes: '' },
      { name: 'Edited', from: '2026-12-20', to: '2026-12-20', notes: 'x' },
      { name: 'Nice', from: '2027-01-05', to: '2027-01-06', notes: 'Hotel' },
    ];
    const out = mergeTrips(d, found, () => 'new', 5).trips;
    expect(out.map((x) => [x.id, x.name, x.to, x.notes])).toEqual([
      ['cal', 'Lyon', '2026-12-03', 'Flight'], ['mine', 'mine', '2026-12-11', 'Train'], ['edited', 'edited', '2026-12-21', ''], ['new', 'Nice', '2027-01-06', 'Hotel'],
    ]);
  });
});
