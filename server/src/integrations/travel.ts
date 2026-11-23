import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readable, readReceipt } from '../agent/claude/receipts.js';
import { jsonFile, NotFound, BadRequest, readBytes, type Body } from '../json.js';
import { CATEGORIES, mimeOf, type Receipt, type Trip, type TravelData } from '../../../shared/travel.js';

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
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export async function saveTrip(body: Record<string, unknown>) {
  const name = text(body.name, 120);
  if (!name) throw new BadRequest('A trip needs a name');
  const fields = { name, from: day(body.from), to: day(body.to), notes: text(body.notes, 20_000) };
  let saved: Trip | undefined;
  await store.update((d) => {
    const id = String(body.id ?? '');
    const old = d.trips.find((t) => t.id === id);
    if (id && !old) throw new NotFound('Trip not found');
    saved = old ? { ...old, ...fields } : { id: randomUUID().slice(0, 8), createdAt: Date.now(), ...fields };
    return { ...d, trips: old ? d.trips.map((t) => (t.id === id ? saved! : t)) : [...d.trips, saved] };
  });
  return saved;
}

export async function deleteTrip(id: string) {
  let gone: Receipt[] = [];
  await store.update((d) => {
    gone = d.receipts.filter((r) => r.tripId === id);
    return { trips: d.trips.filter((t) => t.id !== id), receipts: d.receipts.filter((r) => r.tripId !== id) };
  });
  for (const r of gone) await rm(path.join(FILES, r.file), { force: true });
  return { ok: true };
}

// Saves the uploaded file under the trip and has Claude fill in the fields in the background.
export async function addReceipt(req: Body, tripId: string, name: string) {
  const d = await store.read();
  if (!d.trips.some((t) => t.id === tripId)) throw new NotFound('Trip not found');
  const bytes = await readBytes(req, MAX_FILE, 'Receipts over 30 MB cannot be added');
  const safe = path.basename(name).replace(/[^\w.-]+/g, '-').slice(-80) || 'receipt';
  const id = randomUUID().slice(0, 8);
  const file = `${id}-${safe}`;
  await mkdir(FILES, { recursive: true });
  await writeFile(path.join(FILES, file), bytes);
  const mime = mimeOf(safe);
  const receipt: Receipt = {
    id, tripId, file, name: safe, mime, merchant: '', amount: null, currency: '', date: '', category: 'Other', note: '',
    read: readable(mime) ? 'pending' : 'skipped', addedAt: Date.now(),
  };
  await store.update((cur) => ({ ...cur, receipts: [...cur.receipts, receipt] }));
  if (receipt.read === 'pending') void fillIn(receipt);
  return receipt;
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
