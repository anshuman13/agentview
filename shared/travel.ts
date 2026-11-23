// Work trips and their receipts, kept by the server in ~/.agentview/travel. Android mirrors the logic in TravelLogic.kt.

export const CATEGORIES = ['Flight', 'Train', 'Taxi', 'Hotel', 'Meal', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Trip = { id: string; name: string; from: string; to: string; notes: string; createdAt: number };

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
export type TravelData = { trips: Trip[]; receipts: Receipt[] };

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
