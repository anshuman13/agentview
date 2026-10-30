const STOP = new Set(['about', 'after', 'also', 'from', 'have', 'into', 'just', 'more', 'next', 'only', 'over', 'should', 'some', 'than', 'that', 'their', 'them', 'then', 'there', 'they', 'this', 'until', 'week', 'when', 'will', 'with', 'would']);

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
