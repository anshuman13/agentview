const UNTICKED = /^\s*[-*]\s+\[ \]\s+(.+)$/;

export const normalizeTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The unticked "- [ ] text" lines of the notes that no title in `titles` matches yet, once `strip` has taken the due date out of the line.
export function unmadeActions(notes: string, titles: string[], strip: (line: string) => string): string[] {
  const seen = new Set(titles.map(normalizeTitle));
  const out: string[] = [];
  for (const line of notes.split('\n')) {
    const text = UNTICKED.exec(line)?.[1].trim();
    if (!text) continue;
    const key = normalizeTitle(strip(text) || text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
