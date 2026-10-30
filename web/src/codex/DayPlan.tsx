import type { ItemRow } from './data/sync';
import type { Meeting } from './data/wiki';
import { estimateMin, minutesText, workGaps, type Span } from './data/plan';
import { clock } from './time';

const hhmm = (n: number) => minutesText(Math.round(n / 60_000));

// Today's free gaps in work hours from now, and planned estimates against the free time.
export function DayPlan({ meetings, open, now }: { meetings: Meeting[]; open: ItemRow[]; now: number }) {
  const busy = meetings.filter((m) => m.starts_at != null && m.ends_at != null && m.ends_at > m.starts_at && new Date(m.ends_at).getTime() - m.starts_at < 20 * 3600_000).map((m) => [m.starts_at!, m.ends_at!] as Span);
  const gaps = workGaps(busy, now);
  const planned = open.reduce((n, r) => n + (estimateMin(r.title) ?? 0), 0);
  if (!gaps.length && !planned) return null;
  const free = gaps.reduce((n, [a, b]) => n + b - a, 0);
  return (
    <section>
      <div className="as-section">Plan · planned {minutesText(planned)} / free {hhmm(free)}</div>
      <div className="as-ctx">
        {gaps.map(([a, b]) => <span key={a} className="as-chip">{clock(a)}-{clock(b)}</span>)}
        {!gaps.length && <span className="muted small">No free time left in work hours</span>}
      </div>
    </section>
  );
}
