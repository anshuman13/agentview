// The morning brief card: today's brief per profile and its rows as Duet's "Topic: status" lines.
export type MorningRow = { section: string; title: string; meta: string };

const LABELS: Record<string, string> = { note: 'Note', meetings: 'Meetings', plan: 'Time', tasks: 'Tasks', waiting: 'Waiting', asks: 'Slack asks', said: 'You said', left: 'From last workday' };
const ORDER = Object.keys(LABELS);

const one = (r: MorningRow) => (r.meta ? `${r.title} (${r.meta})` : r.title);

export function morningLines(rows: MorningRow[]) {
  return ORDER.flatMap((section) => {
    const of = rows.filter((r) => r.section === section);
    if (!of.length) return [];
    const text = section === 'plan' || section === 'note' ? of.map(one).join(', ') : `${one(of[0])}${of.length > 1 ? ` and ${of.length - 1} more` : ''}`;
    return [{ label: LABELS[section], text }];
  });
}

export function parseMorningRows(json: string | null | undefined): MorningRow[] {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.filter((r) => r && typeof r.title === 'string').map((r) => ({ section: String(r.section ?? ''), title: r.title, meta: String(r.meta ?? '') })) : [];
  } catch {
    return [];
  }
}
