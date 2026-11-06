export type DigestRow = { id: string; who: string; chat: string; outcome: string; reason: string; edited: boolean; url: string };
export type DigestGroup = { outcome: string; label: string; rows: DigestRow[]; open: boolean };

const GROUPS: Record<'day' | 'away', { outcome: string; label: string; open: boolean }[]> = {
  day: [{ outcome: 'failed', label: 'Failed', open: true }, { outcome: 'sent', label: 'Sent', open: false }, { outcome: 'skipped', label: 'Skipped', open: false }],
  away: [{ outcome: 'escalated', label: 'Escalated', open: true }, { outcome: 'answered', label: 'Answered', open: false }, { outcome: 'held', label: 'Held (note sent)', open: false }, { outcome: 'skipped', label: 'Skipped', open: false }],
};

const FOLDED_ROWS = 3;

// The rows of a day or away brief as groups in display order plus the waiting rows, or null when the JSON is missing, invalid or empty.
export function parseDigest(kind: 'day' | 'away', json: string | null): { groups: DigestGroup[]; waiting: DigestRow[] } | null {
  let rows: unknown;
  try { rows = JSON.parse(json ?? ''); } catch { return null; }
  if (!Array.isArray(rows) || !rows.length) return null;
  const list = rows as DigestRow[];
  return {
    groups: GROUPS[kind].map((g) => ({ ...g, rows: list.filter((r) => r.outcome === g.outcome) })).filter((g) => g.rows.length),
    waiting: list.filter((r) => r.outcome === 'waiting'),
  };
}

// A group that is open by default shows every row; a folded one shows the first 3 until Show all.
export const visibleRows = (g: DigestGroup, all: boolean) => (g.open || all ? g.rows : g.rows.slice(0, FOLDED_ROWS));
