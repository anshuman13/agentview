import type { LiveChat } from '../../../shared/protocol';

export function chatOrder(waiting: LiveChat[], pinned: LiveChat[], groups: { open: LiveChat[] }[]) {
  const ids = [...waiting, ...pinned, ...groups.flatMap((g) => g.open)].map((c) => c.id);
  return [...new Set(ids)];
}

export function stepChat(ids: string[], viewing: string, dir: 1 | -1) {
  if (ids.length < 2) return null;
  const i = ids.indexOf(viewing);
  if (i < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}
