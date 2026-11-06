export type ReportEntry = { key: string; at: number; candidate: boolean };

const ROWS = 5;

// Friday 14:00 local of the review window that `now` is in.
export function reviewStart(now: number) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 2) % 7), 14).getTime();
}

// The newest candidate (or the opened one) is the card; every other entry is a row, newest first, capped unless all. A closed card leaves no card until reload.
export function pickReports<T extends ReportEntry>(entries: T[], opened: string | null, closed: string[], all = false) {
  const live = entries.filter((e) => !closed.includes(e.key)).sort((a, b) => b.at - a.at);
  const candidates = live.filter((e) => e.candidate);
  const card = candidates.find((e) => e.key === opened) ?? (closed.length ? null : candidates[0] ?? null);
  const rows = live.filter((e) => e !== card);
  return { card, rows: all ? rows : rows.slice(0, ROWS), total: rows.length };
}
