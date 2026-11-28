// Mark as viewed on Changes rows: saved maps a row key (s:path or w:path) to the blob it was viewed at.
// Drops rows whose blob changed or that left the list, then flips toggle when given; the result's keys are the viewed rows.
export function viewedAfter(saved: Record<string, string>, hashes: Record<string, string>, toggle?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, h] of Object.entries(saved)) if (hashes[k] === h && k !== toggle) out[k] = h;
  if (toggle && hashes[toggle] && saved[toggle] !== hashes[toggle]) out[toggle] = hashes[toggle];
  return out;
}

export const rowKey = (f: { path: string; staged: boolean }) => `${f.staged ? 's' : 'w'}:${f.path}`;
