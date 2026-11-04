// Word matching for the search boxes: every word of the query must appear in the row's text.
export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
export const matcher = (words: string[]) => (...texts: (string | null | undefined)[]) => {
  const hay = texts.join(' ').toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
};

const haystacks = new WeakMap<object, Map<string, string>>();

// Like matcher, but lowercases each row's text once per row object and field set.
export const rowMatcher = <R extends object>(words: string[], fields: string, texts: (r: R) => (string | null | undefined)[]) => (r: R) => {
  if (!words.length) return false;
  let byFields = haystacks.get(r);
  if (!byFields) haystacks.set(r, (byFields = new Map()));
  let hay = byFields.get(fields);
  if (hay === undefined) byFields.set(fields, (hay = texts(r).join(' ').toLowerCase()));
  return words.every((w) => hay.includes(w));
};
