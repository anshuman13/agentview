import type { ItemRow } from '../sync';

export { matcher, queryWords } from '../../../../../shared/match';

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

export const taskMatches = (r: ItemRow, q: string) => {
  if ([r.title, r.text, r.people].some((x) => x?.toLowerCase().includes(q))) return true;
  const tag = (q.startsWith('#') ? q.slice(1) : q).trim();
  return !!tag && !!r.tags && r.tags.split(/\s+/).some((t) => t.includes(tag));
};
