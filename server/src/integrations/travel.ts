import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { findTrips, readable, readReceipt } from '../agent/claude/receipts.js';
import { hubRows } from './assistant.js';
import { jsonFile, NotFound, BadRequest, readBytes, type Body } from '../json.js';
import { applyTripSave, CATEGORIES, fileTrip, mergeTrips, mimeOf, type Receipt, type Trip, type TravelData } from '../../../shared/travel.js';

const DIR = path.join(os.homedir(), '.agentview', 'travel');
const FILES = path.join(DIR, 'files');
const store = jsonFile<TravelData>(path.join(DIR, 'travel.json'), { trips: [], receipts: [] });
const MAX_FILE = 30_000_000;

const STALE = 5 * 60_000;

// A read still pending after 5 minutes was cut off by a restart, so it shows as failed.
export async function travelData(now = Date.now()) {
  const d = await store.read();
  return { ...d, receipts: d.receipts.map((r) => (r.read === 'pending' && now - r.addedAt > STALE ? { ...r, read: 'failed' as const } : r)) };
}

const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const newId = () => randomUUID().slice(0, 8);
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export async function saveTrip(body: Record<string, unknown>) {
  const name = text(body.name, 120);
  if (!name) throw new BadRequest('A trip needs a name');
  const fields = { name, from: day(body.from), to: day(body.to), ...('notes' in body && { notes: text(body.notes, 20_000) }), ...('plan' in body && { plan: body.plan }) };
  let saved: Trip | undefined;
  await store.update((d) => {
    const id = String(body.id ?? '');
    const old = d.trips.find((t) => t.id === id);
    if (id && !old) throw new NotFound('Trip not found');
    saved = old ? applyTripSave(old, fields, newId) : { id: newId(), createdAt: Date.now(), name, from: fields.from, to: fields.to, notes: fields.notes ?? '' };
    return { ...d, trips: old ? d.trips.map((t) => (t.id === id ? saved! : t)) : [...d.trips, saved] };
  });
  return saved;
}

export async function deleteTrip(id: string) {
  let gone: Receipt[] = [];
  await store.update((d) => {
    gone = d.receipts.filter((r) => r.tripId === id);
    const trip = d.trips.find((t) => t.id === id);
    const dismissed = trip?.calendar ? [...(d.dismissed ?? []), { from: trip.from, to: trip.to }] : d.dismissed;
    return { ...d, trips: d.trips.filter((t) => t.id !== id), receipts: d.receipts.filter((r) => r.tripId !== id), dismissed };
  });
  for (const r of gone) await rm(path.join(FILES, r.file), { force: true });
  return { ok: true };
}

// Saves the uploaded file. Under a trip it is filed at once and Claude fills in the fields in the background; without a trip
// the read is awaited and the receipt is filed under the trip that covers its date.
export async function addReceipt(req: Body, tripId: string, name: string) {
  const d = await store.read();
  if (tripId && !d.trips.some((t) => t.id === tripId)) throw new NotFound('Trip not found');
  if (!tripId && !d.trips.length) throw new BadRequest('Add a trip first');
  const bytes = await readBytes(req, MAX_FILE, 'Receipts over 30 MB cannot be added');
  const safe = path.basename(name).replace(/[^\w.-]+/g, '-').slice(-80) || 'receipt';
  const id = newId();
  const file = `${id}-${safe}`;
  await mkdir(FILES, { recursive: true });
  await writeFile(path.join(FILES, file), bytes);
  const mime = mimeOf(safe);
  const receipt: Receipt = {
    id, tripId, file, name: safe, mime, merchant: '', amount: null, currency: '', date: '', category: 'Other', note: '',
    read: readable(mime) ? 'pending' : 'skipped', addedAt: Date.now(),
  };
  let stored: Receipt | undefined;
  try {
    if (tripId) {
      await store.update((cur) => ({ ...cur, receipts: [...cur.receipts, receipt] }));
      stored = receipt;
      if (receipt.read === 'pending') void fillIn(receipt);
      return receipt;
    }
    const found = receipt.read === 'pending' ? await readReceipt(path.join(FILES, file), mime).catch(() => null) : null;
    const read = found ? 'done' : receipt.read === 'pending' ? 'failed' : 'skipped';
    const filled: Receipt = { ...receipt, ...(found && fill(receipt, found)), read };
    await store.update((cur) => {
      const trip = fileTrip(cur.trips, filled.date, local(Date.now()).slice(0, 10));
      if (!trip) return cur;
      stored = { ...filled, tripId: trip.id };
      return { ...cur, receipts: [...cur.receipts, stored] };
    });
    if (!stored) throw new BadRequest('Add a trip first');
    return stored;
  } finally {
    if (!stored) await rm(path.join(FILES, file), { force: true });
  }
}

async function fillIn(r: Receipt) {
  const found = await readReceipt(path.join(FILES, r.file), r.mime).catch(() => null);
  await store.update((d) => ({
    ...d,
    receipts: d.receipts.map((x) => x.id !== r.id ? x : found ? { ...x, ...fill(x, found), read: 'done' } : { ...x, read: 'failed' }),
  }));
}

// Claude's fields only where the user has not typed one meanwhile.
const fill = (x: Receipt, f: Partial<Receipt>) => ({
  merchant: x.merchant || f.merchant || '',
  amount: x.amount ?? f.amount ?? null,
  currency: x.currency || f.currency || '',
  date: x.date || f.date || '',
  category: x.category !== 'Other' ? x.category : f.category ?? 'Other',
});

export async function updateReceipt(body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  let saved: Receipt | undefined;
  await store.update((d) => {
    const old = d.receipts.find((r) => r.id === id);
    if (!old) throw new NotFound('Receipt not found');
    const amount = body.amount === '' || body.amount === null ? null : Number(String(body.amount ?? old.amount ?? '').replace(',', '.'));
    saved = {
      ...old,
      merchant: 'merchant' in body ? text(body.merchant, 80) : old.merchant,
      amount: 'amount' in body ? (amount != null && Number.isFinite(amount) ? amount : null) : old.amount,
      currency: 'currency' in body ? text(body.currency, 3).toUpperCase() : old.currency,
      date: 'date' in body ? day(body.date) : old.date,
      category: CATEGORIES.find((c) => c === body.category) ?? old.category,
      note: 'note' in body ? text(body.note, 500) : old.note,
      tripId: typeof body.tripId === 'string' && d.trips.some((t) => t.id === body.tripId) ? body.tripId : old.tripId,
    };
    return { ...d, receipts: d.receipts.map((r) => (r.id === id ? saved! : r)) };
  });
  return saved;
}

export async function deleteReceipt(id: string) {
  let file = '';
  await store.update((d) => {
    file = d.receipts.find((r) => r.id === id)?.file ?? '';
    return { ...d, receipts: d.receipts.filter((r) => r.id !== id) };
  });
  if (file) await rm(path.join(FILES, file), { force: true });
  return { ok: true };
}

export async function receiptFile(id: string) {
  const r = (await store.read()).receipts.find((x) => x.id === id);
  if (!r) throw new NotFound('Receipt not found');
  return { body: await readFile(path.join(FILES, r.file)), mime: r.mime, name: r.name };
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const local = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Calendar events from 30 days back to 120 ahead as lines, both profiles, without the copies of one event in two calendars.
export function eventLines(rows: Record<string, unknown>[], now: number) {
  const lines = rows
    .filter((r) => r.calendar_url && Number(r.starts_at) > now - 30 * DAY && Number(r.starts_at) < now + 120 * DAY)
    .sort((a, b) => Number(a.starts_at) - Number(b.starts_at))
    .map((r) => [local(Number(r.starts_at)), local(Number(r.ends_at || r.starts_at)), String(r.title ?? '').trim(), String(r.room ?? '').trim()].join(' | '));
  return [...new Set(lines)].join('\n');
}

// Has Claude find the trips in the calendar and adds them (Find in calendar on the Travel page).
export async function scanCalendar(now = Date.now(), find = findTrips) {
  const events = eventLines(await hubRows('meetings'), now);
  if (!events) return { added: 0, updated: 0 };
  const found = await find(events);
  let result = { added: 0, updated: 0 };
  await store.update((d) => {
    const { added, updated, ...next } = mergeTrips(d, found, newId, now);
    result = { added, updated };
    return next;
  });
  return result;
}
