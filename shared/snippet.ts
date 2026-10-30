const SNIPPET = 48;

// A short stretch of the first text that holds a word, centred on the word.
export function snippet(words: string[], ...texts: (string | null | undefined)[]) {
  for (const text of texts) {
    if (!text) continue;
    const lower = text.toLowerCase();
    const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (at == null) continue;
    const from = Math.max(0, at - SNIPPET);
    const to = Math.min(text.length, at + SNIPPET);
    return `${from > 0 ? '...' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '...' : ''}`;
  }
  return '';
}
