// One calendar event can arrive twice: the same id on the work and personal calendars, or a copy added by hand or from an
// email with another id and a reworded title ("Flight to Stockholm (D8 4102)"). Such copies show once.
type Ev = { id: string; title: string | null; starts_at: number | null; ends_at: number | null };

const words = (t: string | null) => new Set((t ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

export function sameEvent(a: Ev, b: Ev) {
  if (a.id === b.id) return true;
  if (a.starts_at == null || a.starts_at !== b.starts_at || a.ends_at !== b.ends_at) return false;
  const x = words(a.title), y = words(b.title);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared > 0 && shared >= 0.6 * Math.min(x.size, y.size);
}

// The rows without later copies of an earlier one, in their order.
export function uniqueEvents<T extends Ev>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const r of rows) if (!kept.some((k) => sameEvent(k, r))) kept.push(r);
  return kept;
}
