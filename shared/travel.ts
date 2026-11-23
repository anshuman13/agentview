// Work trips and their receipts, kept by the server in ~/.agentview/travel. Android mirrors the logic in TravelLogic.kt.

export const CATEGORIES = ['Flight', 'Train', 'Taxi', 'Hotel', 'Meal', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const PLAN_KINDS = ['flight', 'train', 'taxi', 'hotel', 'meal', 'event', 'other'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const KIND_ICONS: Record<PlanKind, string> = { flight: 'send', train: 'arrow-right', taxi: 'location', hotel: 'home', event: 'calendar', meal: 'coffee', other: 'circle-filled' };

// day is YYYY-MM-DD; start and end are HH:MM wall-clock times, or '' (an end needs a start).
export type PlanItem = { id: string; day: string; start: string; end: string; kind: PlanKind; title: string; place: string; ref: string };

// calendar: found in the calendar, and kept up to date from it until the user edits it (edited). A missing plan reads as [].
export type Trip = { id: string; name: string; from: string; to: string; notes: string; plan?: PlanItem[]; createdAt: number; calendar?: boolean; edited?: boolean };

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

export type TripState = '' | 'now' | 'upcoming' | 'past';

export const tripState = (t: Pick<Trip, 'from' | 'to'>, today: string): TripState =>
  !t.from ? '' : t.from <= today && today <= (t.to || t.from) ? 'now' : t.from > today ? 'upcoming' : 'past';

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
const addDay = (d: string) => new Date((dayNumber(d) + 1) * 86_400_000).toISOString().slice(0, 10);

export function tripStateText(t: Pick<Trip, 'from' | 'to'>, today: string) {
  const state = tripState(t, today);
  if (state !== 'upcoming') return { '': '', now: 'Now', past: 'Past' }[state];
  const n = dayNumber(t.from) - dayNumber(today);
  return n === 1 ? 'In 1 day' : `In ${n} days`;
}

// Trips with today inside their dates first, then upcoming by start, then past by end, newest first, undated last.
export function sortTrips(trips: Trip[], today: string) {
  const rank = (t: Trip) => ['now', 'upcoming', 'past', ''].indexOf(tripState(t, today));
  return [...trips].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? (b.to || b.from).localeCompare(a.to || a.from) : rank(a) === 3 ? 0 : a.from.localeCompare(b.from)));
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const byTime = (a: PlanItem, b: PlanItem) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start);

// The plan items that have a title and a day, with bad kinds, times and ids repaired, in time order.
export function cleanPlan(raw: unknown, newId: () => string): PlanItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items = raw.flatMap((r): PlanItem[] => {
    const title = clip(r?.title, 120);
    if (!title || !isDay(r.day)) return [];
    const start = isTime(r.start) ? r.start : '';
    const kind = PLAN_KINDS.find((k) => k === clip(r.kind, 20).toLowerCase()) ?? 'other';
    let id = clip(r.id, 40);
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    return [{ id, day: r.day, start, end: start && isTime(r.end) ? r.end : '', kind, title, place: clip(r.place, 80), ref: clip(r.ref, 80) }];
  });
  return items.sort(byTime).slice(0, 200);
}

// Whether two plans hold the same items, ignoring ids.
export const samePlan = (a: PlanItem[], b: PlanItem[]) =>
  a.length === b.length && a.every((x, i) => (['day', 'start', 'end', 'kind', 'title', 'place', 'ref'] as const).every((k) => x[k] === b[i][k]));

// One entry per day with items, in day order.
export function groupPlan(plan: PlanItem[]) {
  const days: { day: string; items: PlanItem[] }[] = [];
  for (const item of [...plan].sort(byTime)) {
    const last = days[days.length - 1];
    if (last?.day === item.day) last.items.push(item);
    else days.push({ day: item.day, items: [item] });
  }
  return days;
}

// The first timed item still to come at now ("YYYY-MM-DD HH:MM", local): its end, or its start without one, is after now.
export function nextItem(plan: PlanItem[], now: string) {
  return [...plan].sort(byTime).find((i) => i.start && `${i.end && i.end < i.start ? addDay(i.day) : i.day} ${i.end || i.start}` > now);
}

// The trip a receipt dated date belongs to: the one covering it, else the Now trip, else the nearest by dates.
export function fileTrip(trips: Trip[], date: string, today: string) {
  const dated = sortTrips(trips, today).filter((t) => t.from);
  if (!dated.length) return trips[0];
  const d = date || today;
  const gap = (t: Trip) => Math.max(dayNumber(t.from) - dayNumber(d), dayNumber(d) - dayNumber(t.to || t.from), 0);
  const nearest = dated.reduce((best, t) => (gap(t) < gap(best) || (gap(t) === gap(best) && t.from < best.from) ? t : best));
  return dated.find((t) => gap(t) === 0) ?? dated.find((t) => tripState(t, today) === 'now') ?? nearest;
}

export type FoundTrip = Pick<Trip, 'name' | 'from' | 'to'> & { plan: PlanItem[] };

export const TRIPS_PROMPT = [
  'These are calendar events, one per line: start | end | title | location. Dates and times are local.',
  'Find the trips, for work or leisure: days the user spends away from their home city, shown by flights, trains, hotel stays or events in another city. Leave out events at home and plans to book travel.',
  'Answer with a JSON array and nothing else, one object per trip:',
  '{"name": "<destination and what the trip is for, such as Stockholm training or Paris holiday>", "from": "<YYYY-MM-DD of departure>", "to": "<YYYY-MM-DD of return>", "plan": [{"d": "<YYYY-MM-DD>", "s": "<HH:MM start or empty>", "e": "<HH:MM end or empty>", "k": "<flight, train, taxi, hotel, meal, event or other>", "t": "<title, such as the route or the event>", "p": "<place>", "r": "<flight number or booking code>"}]}',
  'The plan lists each flight or train, the hotel stay, and the events on the trip in time order, at most 40 items. Take d, s and e from the event lines as they are written, so you guess no year or time zone. No notes.',
  'Answer [] when there are no trips.',
].join('\n');

// The trips Claude's answer holds, dropping any without a name or valid dates.
export function parseTrips(text: string, newId: () => string): FoundTrip[] {
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
    const name = clip(t?.name, 120);
    if (!name || !isDay(t.from)) return [];
    const to = isDay(t.to) && t.to >= t.from ? t.to : t.from;
    const plan = Array.isArray(t.plan) ? t.plan.map((p: Record<string, unknown> | null) => ({ day: p?.d, start: p?.s, end: p?.e, kind: p?.k, title: p?.t, place: p?.p, ref: p?.r })) : [];
    return [{ name, from: t.from, to, plan: cleanPlan(plan, newId) }];
  });
}

const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => !!a.from && a.from <= (b.to || b.from) && b.from <= (a.to || a.from);

// Puts the found trips into the data: a calendar trip the user has not edited follows the calendar (its notes go when it takes
// a new plan), a trip the user made gets the found plan only while its own is empty, and a new trip is added unless the user
// deleted one on those dates.
export function mergeTrips(d: TravelData, found: FoundTrip[], newId: () => string, now: number): TravelData & { added: number; updated: number } {
  let trips = d.trips;
  let added = 0;
  let updated = 0;
  for (const f of found) {
    const match = trips.find((t) => overlaps(t, f));
    if (match) {
      const mine = match.plan ?? [];
      let next = match;
      if (match.calendar && !match.edited) {
        next = { ...match, name: f.name, from: f.from, to: f.to };
        if (f.plan.length && !samePlan(f.plan, mine)) next = { ...next, plan: f.plan, notes: '' };
      } else if (!match.calendar && f.plan.length && !mine.length) {
        next = { ...match, plan: f.plan };
      }
      if (next.name !== match.name || next.from !== match.from || next.to !== match.to || next.plan !== match.plan) updated++;
      trips = trips.map((t) => (t === match ? next : t));
    } else if (!(d.dismissed ?? []).some((x) => overlaps(x, f))) {
      trips = [...trips, { id: newId(), createdAt: now, calendar: true, notes: '', ...f }];
      added++;
    }
  }
  return { ...d, trips, added, updated };
}

export type TripFields = { name: string; from: string; to: string; notes?: string; plan?: unknown };

// A saved trip: notes and plan change only when sent, and a calendar trip counts as edited only when something differs.
export function applyTripSave(old: Trip, fields: TripFields, newId: () => string): Trip {
  const plan = fields.plan === undefined ? old.plan : cleanPlan(fields.plan, newId);
  const next = { ...old, name: fields.name, from: fields.from, to: fields.to, notes: fields.notes ?? old.notes, ...(plan && { plan }) };
  const differs = next.name !== old.name || next.from !== old.from || next.to !== old.to || next.notes !== old.notes || !samePlan(next.plan ?? [], old.plan ?? []);
  return old.calendar && differs ? { ...next, edited: true } : next;
}

const count = (n: number) => `${n} trip${n === 1 ? '' : 's'}`;

// What a calendar scan did, for the notice after Find in calendar.
export function scanText(added: number, updated: number) {
  if (!added && !updated) return 'No new trips in the calendar';
  return [added ? `Added ${count(added)}` : '', updated ? `${added ? 'updated' : 'Updated'} ${count(updated)}` : ''].filter(Boolean).join(', ');
}
