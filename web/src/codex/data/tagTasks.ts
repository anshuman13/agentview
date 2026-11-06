import { tagList } from '../AddSheet';
import { atTime } from './engine';
import type { ItemRow } from './sync';

// Open tasks carrying exactly this tag in any profile, by due time (undated last), then rank.
export const tagTasks = (items: ItemRow[], tag: string) => {
  const t = tag.toLowerCase();
  return items
    .filter((r) => r.status === 'open' && !r.deleted && tagList(r.tags).some((x) => x.toLowerCase() === t))
    .sort((a, b) => (atTime(a.at) ?? Infinity) - (atTime(b.at) ?? Infinity) || (a.rank ?? 1e15) - (b.rank ?? 1e15));
};
