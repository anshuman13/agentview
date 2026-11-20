export const STOP = new Set(['about', 'after', 'also', 'from', 'have', 'into', 'just', 'more', 'next', 'only', 'over', 'should', 'some', 'than', 'that', 'their', 'them', 'then', 'there', 'they', 'this', 'until', 'week', 'when', 'will', 'with', 'would']);

export const keyWords = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)?.filter((w) => !STOP.has(w)) ?? []);
export const titleWords = (t: string) => t.toLowerCase().split(/\s+/).filter(Boolean);

// A decision may change a claim when the decision or its meeting title names the claim's page and the two share at least two key words.
export function mayChange(d: { words: Set<string>; hay: string }, claim: Set<string>, title: string[]) {
  if (!title.length || !title.every((w) => d.hay.includes(w))) return false;
  let n = 0;
  for (const w of d.words) if (claim.has(w) && ++n >= 2) return true;
  return false;
}

export const decisionKey = (text: string, meetingTitle: string | null) => ({ words: keyWords(text), hay: `${meetingTitle ?? ''} ${text}`.toLowerCase() });

export const SIMILAR = 0.6;

// The share of the shorter text's key words that the other text has too; 0 when either has none.
export function overlap(a: Set<string>, b: Set<string>) {
  const [short, long] = a.size <= b.size ? [a, b] : [b, a];
  if (!short.size) return 0;
  let n = 0;
  for (const w of short) if (long.has(w)) n++;
  return n / short.size;
}

// The claim that overlaps the text most, when it reaches SIMILAR.
export function similarClaim<T extends { text: string }>(text: string, claims: T[]): T | undefined {
  const words = keyWords(text);
  let best: T | undefined;
  let top = SIMILAR;
  for (const c of claims) {
    const score = overlap(words, keyWords(c.text));
    if (score >= top && (!best || score > top)) [best, top] = [c, score];
  }
  return best;
}

// The ids of claims that another claim from the same folder is similar to, so a correction repeated in one repo can become a rule there.
export function repeatedInFolder(claims: { id: string; text: string; folder?: string }[]) {
  const byFolder = new Map<string, typeof claims>();
  for (const c of claims) if (c.folder) byFolder.set(c.folder, [...(byFolder.get(c.folder) ?? []), c]);
  const out = new Set<string>();
  for (const list of byFolder.values()) for (const c of list) if (similarClaim(c.text, list.filter((o) => o.id !== c.id))) out.add(c.id);
  return out;
}
