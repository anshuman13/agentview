import { formatAmount, totalsText, type Receipt, type Trip } from '../../../shared/travel';
import { plural } from '../ui/util';

const MAX_SIDE = 2000;
const fmt = (d: string, year: boolean) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }) });

export function tripDates(t: Trip) {
  if (!t.from) return '';
  if (!t.to || t.to === t.from) return fmt(t.from, false);
  return `${fmt(t.from, false)} to ${fmt(t.to, false)}`;
}

export function tripMeta(t: Trip, receipts: Receipt[]) {
  const sum = totalsText(receipts);
  return [tripDates(t), receipts.length ? plural(receipts.length, 'receipt') : '', sum, t.calendar ? 'From calendar' : ''].filter(Boolean).join(' · ');
}

export function receiptMeta(r: Receipt) {
  if (r.read === 'pending') return 'Reading…';
  const amount = r.amount == null ? (r.read === 'failed' ? 'Could not read, add the amount' : 'No amount') : `${formatAmount(r.amount)} ${r.currency}`;
  return [r.date ? fmt(r.date, false) : '', r.category, amount].filter(Boolean).join(' · ');
}

export const isImage = (r: Receipt) => r.mime.startsWith('image/') && r.mime !== 'image/heic';

// A photo is scaled to at most 2000px on its long side as a JPEG, so phone photos upload fast and Claude can read them.
export async function shrink(f: File): Promise<{ blob: Blob; name: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return { blob: f, name: f.name };
  try {
    const img = await createImageBitmap(f);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    if (scale === 1 && f.size < 3_000_000) return { blob: f, name: f.name };
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    return blob ? { blob, name: f.name.replace(/\.\w+$/, '') + '.jpg' } : { blob: f, name: f.name };
  } catch {
    return { blob: f, name: f.name };
  }
}
