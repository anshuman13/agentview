// Work trips and their receipts, kept by the server in ~/.agentview/travel. Android mirrors the logic in TravelLogic.kt.

export const CATEGORIES = ['Flight', 'Train', 'Taxi', 'Hotel', 'Meal', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

// calendar: found in the calendar, and kept up to date from it until the user edits it (edited).
export type Trip = { id: string; name: string; from: string; to: string; notes: string; createdAt: number; calendar?: boolean; edited?: boolean };

// read: pending while Claude reads the file, done or failed after, skipped for a file it cannot read (not an image or PDF).
export type Receipt = {
  id: string;
  tripId: string;
  file: string;
  name: string;
  mime: string;
  merchant: string;
  amount: number | null;
  currency: string;
  date: string;
  category: Category;
  note: string;
  read: 'pending' | 'done' | 'failed' | 'skipped';
  addedAt: number;
};

export type ReceiptFields = Partial<Pick<Receipt, 'merchant' | 'amount' | 'currency' | 'date' | 'category'>>;
// dismissed: dates of calendar trips the user deleted, so they are not found again.
export type TravelData = { trips: Trip[]; receipts: Receipt[]; dismissed?: { from: string; to: string }[] };

export const RECEIPT_PROMPT = [
  'This is a receipt or invoice from a work trip. Answer with one JSON object and nothing else:',
  '{"merchant": "<shop, airline, hotel or company>", "amount": <total paid as a number>, "currency": "<ISO code such as NOK or EUR>", "date": "<YYYY-MM-DD of the purchase>", "category": "<one of Flight, Train, Taxi, Hotel, Meal, Other>"}',
  'Use null for anything you cannot read.',
].join('\n');

const MIMES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', pdf: 'application/pdf',
};

export const mimeOf = (name: string) => MIMES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

// The fields Claude's answer holds, dropping any that are missing or malformed.
export function parseReceipt(text: string): ReceiptFields {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return {};
  }
  const out: ReceiptFields = {};
  if (typeof raw.merchant === 'string' && raw.merchant.trim()) out.merchant = raw.merchant.trim().slice(0, 80);
  const amount = typeof raw.amount === 'string' ? Number(raw.amount.replace(',', '.')) : raw.amount;
  if (typeof amount === 'number' && Number.isFinite(amount)) out.amount = Math.round(amount * 100) / 100;
  if (typeof raw.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency.trim())) out.currency = raw.currency.trim().toUpperCase();
  if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) out.date = raw.date;
  const cat = CATEGORIES.find((c) => c.toLowerCase() === String(raw.category ?? '').toLowerCase());
  if (cat) out.category = cat;
  return out;
}

// The sum per currency, largest first, skipping receipts without an amount.
export function totals(receipts: Receipt[]) {
  const by = new Map<string, number>();
  for (const r of receipts) if (r.amount != null) by.set(r.currency || '?', (by.get(r.currency || '?') ?? 0) + r.amount);
  return [...by].map(([currency, sum]) => ({ currency, sum: Math.round(sum * 100) / 100 })).sort((a, b) => b.sum - a.sum);
}

export const totalsText = (receipts: Receipt[]) => totals(receipts).map((t) => `${formatAmount(t.sum)} ${t.currency}`).join(' + ');

export const formatAmount = (n: number) => n.toFixed(2).replace(/\.00$/, '');

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// One line per receipt, oldest first, for the expense report.
export function receiptsCsv(receipts: Receipt[]) {
  const rows = [...receipts].sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || a.addedAt - b.addedAt);
  const lines = rows.map((r) => [r.date, r.merchant, r.category, r.amount == null ? '' : formatAmount(r.amount), r.currency, r.note, r.name].map(cell).join(','));
  return ['Date,Merchant,Category,Amount,Currency,Note,File', ...lines].join('\n') + '\n';
}

// Trips with today inside their dates first, then upcoming by start, then past by end, newest first.
export function sortTrips(trips: Trip[], today: string) {
  const rank = (t: Trip) => (t.from <= today && today <= (t.to || t.from) ? 0 : t.from > today ? 1 : 2);
  return [...trips].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? (b.to || b.from).localeCompare(a.to || a.from) : a.from.localeCompare(b.from)));
}

export type FoundTrip = Pick<Trip, 'name' | 'from' | 'to' | 'notes'>;

export const TRIPS_PROMPT = [
  'These are calendar events, one per line: start | end | title | location. Times are local.',
  'Find the trips, for work or leisure: days the user spends away from their home city, shown by flights, trains, hotel stays or events in another city. Leave out events at home and plans to book travel.',
  'Answer with a JSON array and nothing else, one object per trip:',
  '{"name": "<destination and what the trip is for, such as Stockholm training or Paris holiday>", "from": "<YYYY-MM-DD of departure>", "to": "<YYYY-MM-DD of return>", "notes": "<the plan as short lines in time order: each flight or train with its number and times, the hotel, and the events on the trip with times and places>"}',
  'Answer [] when there are no trips.',
].join('\n');

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// The trips Claude's answer holds, dropping any without a name or valid dates.
export function parseTrips(text: string): FoundTrip[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    const name = typeof t?.name === 'string' ? t.name.trim().slice(0, 120) : '';
    if (!name || !isDay(t.from)) return [];
    const to = isDay(t.to) && t.to >= t.from ? t.to : t.from;
    return [{ name, from: t.from, to, notes: typeof t.notes === 'string' ? t.notes.trim().slice(0, 20_000) : '' }];
  });
}

const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => !!a.from && a.from <= (b.to || b.from) && b.from <= (a.to || a.from);

// Puts the found trips into the data: a calendar trip the user has not edited follows the calendar, a trip the user made
// gets the found notes only while its own are empty, and a new trip is added unless the user deleted one on those dates.
export function mergeTrips(d: TravelData, found: FoundTrip[], newId: () => string, now: number): TravelData & { added: number; updated: number } {
  let trips = d.trips;
  let added = 0;
  let updated = 0;
  for (const f of found) {
    const match = trips.find((t) => overlaps(t, f));
    if (match) {
      const next = match.calendar ? (match.edited ? match : { ...match, ...f }) : match.notes.trim() ? match : { ...match, notes: f.notes };
      if (next !== match && (next.name !== match.name || next.from !== match.from || next.to !== match.to || next.notes !== match.notes)) updated++;
      trips = trips.map((t) => (t === match ? next : t));
    } else if (!(d.dismissed ?? []).some((x) => overlaps(x, f))) {
      trips = [...trips, { id: newId(), createdAt: now, calendar: true, ...f }];
      added++;
    }
  }
  return { ...d, trips, added, updated };
}

const count = (n: number) => `${n} trip${n === 1 ? '' : 's'}`;

// What a calendar scan did, for the notice after Find in calendar.
export function scanText(added: number, updated: number) {
  if (!added && !updated) return 'No new trips in the calendar';
  return [added ? `Added ${count(added)}` : '', updated ? `${added ? 'updated' : 'Updated'} ${count(updated)}` : ''].filter(Boolean).join(', ');
}
