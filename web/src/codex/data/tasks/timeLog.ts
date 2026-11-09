export type Session = { id: string; at: number; min: number };

// A task's time log is JSON text; anything that is not a list of sessions reads as empty.
export function parseLog(raw: string | null | undefined): Session[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((s): s is Session => typeof s?.id === 'string' && Number.isFinite(s.at) && Number.isFinite(s.min) && s.min > 0);
  } catch {
    return [];
  }
}

export const appendSession = (raw: string | null | undefined, s: Session) => JSON.stringify([...parseLog(raw), s]);

// The patch that drops a session and takes its minutes off spent, not below 0.
export function removeSession(raw: string | null | undefined, spent: number | null | undefined, id: string) {
  const list = parseLog(raw);
  const gone = list.find((s) => s.id === id);
  const left = list.filter((s) => s.id !== id);
  const total = Math.max(0, (Number(spent) || 0) - (gone?.min ?? 0));
  return { time_log: left.length ? JSON.stringify(left) : null, spent: total || null };
}
