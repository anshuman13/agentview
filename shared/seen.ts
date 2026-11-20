export type SeenMark = { id: string; value: number; at: number; sent: boolean };

// The server's seen times with each local mark applied that its POST has not confirmed, or that was made once the load began (the server's answer may predate it). Value 0 is Mark as unread. shared/fixtures/merge-seen.json holds the cases.
export function mergeSeen(server: Record<string, number>, marks: SeenMark[], startedAt: number): Record<string, number> {
  const seen = { ...server };
  for (const m of marks) if (!m.sent || m.at >= startedAt) seen[m.id] = m.value;
  return seen;
}
