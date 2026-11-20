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

export const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();

const MAX_REJECTED = 20;
const REJECTED_DAYS = 90;

// The claims the user rejected in the last 90 days, newest 20, which Haiku must not propose again and saveLearned and wiki_propose skip.
export const recentlyRejected = <T extends { text: string; state: string | null; updated_at: number }>(rows: T[], now: number) =>
  rows.filter((f) => f.state === 'rejected' && f.updated_at > now - REJECTED_DAYS * 86_400_000).sort((a, b) => b.updated_at - a.updated_at).slice(0, MAX_REJECTED);

// Drops a final "s" that follows four letters other than s.
const singular = (t: string) => (/[^s]{4}s$/.test(t) ? t.slice(0, -1) : t);

const pageKey = (t: string) => singular(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ').replace(/^the /, ''));

// The first live or proposed page whose title matches, ignoring case, punctuation, a leading "the" and a trailing plural "s". A rejected page never matches.
export function samePage<T extends { title: string; state?: string | null }>(title: string, pages: T[]): T | undefined {
  const key = pageKey(title);
  return key ? pages.find((p) => [undefined, null, 'live', 'proposed'].includes(p.state) && pageKey(p.title) === key) : undefined;
}

// The ids of claims that another claim from the same folder is similar to, so a correction repeated in one repo can become a rule there.
export function repeatedInFolder(claims: { id: string; text: string; folder?: string }[]) {
  const byFolder = new Map<string, typeof claims>();
  for (const c of claims) if (c.folder) byFolder.set(c.folder, [...(byFolder.get(c.folder) ?? []), c]);
  const out = new Set<string>();
  for (const list of byFolder.values()) for (const c of list) if (similarClaim(c.text, list.filter((o) => o.id !== c.id))) out.add(c.id);
  return out;
}
