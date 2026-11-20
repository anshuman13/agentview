// Word matching for the search boxes: every word of the query must appear in the text.
export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
export const matcher = (words: string[]) => (...texts: (string | null | undefined)[]) => {
  const hay = texts.join(' ').toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
};
