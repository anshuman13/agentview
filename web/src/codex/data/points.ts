import { madeAt, type ItemRow, type Profile } from './sync';
import { live, othersOf, type Meeting } from './wiki';
import { peopleOf, sameName } from './meetings';

// A point to raise is an item with status 'point' naming one person; ticked off or past its meeting it becomes 'raised'.
export const POINT = 'point';
export const RAISED = 'raised';

const isPoint = (r: ItemRow) => !r.deleted && r.status === POINT && !!r.people?.trim();
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

// The first meeting with the point's person that starts after the point was raised.
export function pointMeeting(point: ItemRow, meetings: Meeting[]) {
  const since = madeAt(point);
  let best: Meeting | undefined;
  for (const m of live(meetings)) {
    if (m.profile !== point.profile || m.starts_at == null || m.starts_at < since) continue;
    if (!peopleOf(m).some((p) => sameName(p, point.people!))) continue;
    if (!best || m.starts_at < best.starts_at!) best = m;
  }
  return best;
}

export const pointsOf = (items: ItemRow[], person: string) =>
  items.filter((r) => isPoint(r) && sameName(r.people!, person)).sort((a, b) => madeAt(a) - madeAt(b));

export const pointsFor = (m: Meeting, items: ItemRow[], meetings: Meeting[]) =>
  items.filter((r) => isPoint(r) && pointMeeting(r, meetings) === m).sort((a, b) => madeAt(a) - madeAt(b));

// Open points whose meeting has ended.
export const endedPoints = (items: ItemRow[], meetings: Meeting[], now = Date.now()) =>
  items.filter((r) => {
    const m = isPoint(r) && pointMeeting(r, meetings);
    return !!m && (m.ends_at ?? m.starts_at!) <= now;
  });

// What the meeting's attendees took on in the given earlier meetings, as "Name: what".
export const theirActions = (m: Meeting, earlier: Meeting[]) =>
  [...new Set(earlier.flatMap((x) => othersOf(x).filter((o) => peopleOf(m).some((p) => sameName(p, o.who))).map((o) => `${firstName(o.who)}: ${o.what}`)))];

// Attendees of the given meeting first, then of the latest meetings of the profile that have started.
export function recentPeople(meetings: Meeting[], profile: Profile, first: Meeting | null = null, max = 6, now = Date.now()) {
  const recent = live(meetings).filter((m) => m.profile === profile && m.starts_at != null && m.starts_at <= now).sort((a, b) => b.starts_at! - a.starts_at!);
  const out: string[] = [];
  for (const m of first ? [first, ...recent] : recent) {
    for (const p of peopleOf(m)) {
      if (out.length >= max) return out;
      if (!out.some((q) => sameName(p, q))) out.push(p);
    }
  }
  return out;
}
