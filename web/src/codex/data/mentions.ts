import { keyWords } from '../../../../shared/claimMatch';
import type { ItemRow } from './sync';
import { byDue } from './tagTasks';
import { live, type Meeting } from './wiki';

export const MENTIONS_SHOWN = 3;

export type Mention = { kind: 'task' | 'meeting'; profile: string; id: string; title: string; at: number | null };
export type Mentions = { shown: Mention[]; rest: Mention[] };
type Entry = { mention: Mention; hay: string; words: Set<string>; order: number };

const indexes = new WeakMap<object, Map<string, Entry[]>>();
// One word index per source array, built once and reused while the array is unchanged.
function indexOf<T extends object>(rows: T[], entries: (rows: T[]) => Omit<Entry, 'order'>[]) {
  let idx = indexes.get(rows);
  if (idx) return idx;
  const words = (idx = new Map<string, Entry[]>());
  entries(rows).forEach((e, order) => {
    const full = { ...e, order };
    for (const w of e.words) {
      const hit = words.get(w);
      if (hit) hit.push(full);
      else words.set(w, [full]);
    }
  });
  indexes.set(rows, words);
  return words;
}

const entry = (mention: Mention, ...parts: (string | null)[]) => {
  const text = parts.join(' ');
  return { mention, hay: text.toLowerCase(), words: keyWords(text) };
};
const taskEntries = (items: ItemRow[]) => items.filter((r) => r.status === 'open' && !r.deleted).sort(byDue)
  .map((r) => entry({ kind: 'task', profile: r.profile, id: r.id, title: r.title || r.text || 'Untitled', at: null }, r.title, r.text));
const meetingEntries = (meetings: Meeting[]) => live(meetings).sort((a, b) => (b.starts_at ?? 0) - (a.starts_at ?? 0))
  .map((m) => entry({ kind: 'meeting', profile: m.profile, id: m.id, title: m.title || 'Meeting', at: m.starts_at }, m.title, m.notes, m.summary, m.decisions));

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
function hasPhrase(hay: string, phrase: string) {
  for (let i = hay.indexOf(phrase); i >= 0; i = hay.indexOf(phrase, i + 1)) {
    if (!isWord(hay[i - 1]) && !isWord(hay[i + phrase.length])) return true;
  }
  return false;
}

// Open tasks (due time, undated last) then meetings (newest first) that name the page title as a whole phrase and share a key word of the claim that the title lacks.
export function mentionsOf(data: { items: ItemRow[]; meetings: Meeting[] }, claim: { text: string | null; profile: string }, title: string | null | undefined): Mentions {
  const phrase = (title ?? '').trim().toLowerCase();
  if (phrase.length < 3 || !claim.text) return { shown: [], rest: [] };
  const skip = keyWords(phrase);
  const words = [...keyWords(claim.text)].filter((w) => !skip.has(w));
  const out: Mention[] = [];
  for (const idx of [indexOf(data.items, taskEntries), indexOf(data.meetings, meetingEntries)]) {
    const found = new Set<Entry>();
    for (const w of words) for (const e of idx.get(w) ?? []) if (e.mention.profile === claim.profile && hasPhrase(e.hay, phrase)) found.add(e);
    out.push(...[...found].sort((a, b) => a.order - b.order).map((e) => e.mention));
  }
  return { shown: out.slice(0, MENTIONS_SHOWN), rest: out.slice(MENTIONS_SHOWN) };
}
