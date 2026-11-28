// Nest under: a chat the user placed under another chat's row, keyed by the child's session id.
export type Nests = Record<string, string>;

type Chat = { sessionId: string; title: string; cwd: string; nestedIn?: string };

// True when nesting child under parent would loop: parent is child or sits under it.
export function nestLoops(nests: Nests, child: string, parent: string) {
  for (let at: string | undefined = parent, n = 0; at && n < 100; at = nests[at], n++) if (at === child) return true;
  return false;
}

// The chats id can nest under, matching query in the title or folder: not itself, not a chat nested under it.
export function nestTargets<C extends Chat>(chats: C[], id: string, query = '') {
  const nests: Nests = Object.fromEntries(chats.flatMap((c) => (c.nestedIn ? [[c.sessionId, c.nestedIn]] : [])));
  const q = query.trim().toLowerCase();
  return chats.filter((c) => !nestLoops(nests, id, c.sessionId) && c.sessionId !== chats.find((x) => x.sessionId === id)?.nestedIn && (!q || c.title.toLowerCase().includes(q) || c.cwd.toLowerCase().includes(q)));
}

// The chats nested under each listed chat, newest first. A chat whose parent is not listed is not nested.
export function nestedRows<C extends Chat & { lastModified: number }>(chats: C[]) {
  const ids = new Set(chats.map((c) => c.sessionId));
  const under = new Map<string, C[]>();
  for (const c of chats) if (c.nestedIn && ids.has(c.nestedIn)) under.set(c.nestedIn, [...(under.get(c.nestedIn) ?? []), c]);
  for (const l of under.values()) l.sort((a, b) => b.lastModified - a.lastModified);
  return under;
}

// The chats left as their own rows once the nested ones moved under their parents.
export const withoutNested = <C extends { sessionId: string }>(chats: C[], under: Map<string, C[]>) => {
  const nested = new Set([...under.values()].flat().map((c) => c.sessionId));
  return chats.filter((c) => !nested.has(c.sessionId));
};
