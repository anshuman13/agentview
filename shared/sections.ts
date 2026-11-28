// Move to section: user-named sidebar sections, keyed by the chat's session id.
export type Sections = Record<string, string>;

type Chat = { sessionId: string; section?: string; lastModified: number };

export const sectionName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, 60);

// The sections in use with their chat counts, by name.
export function sectionList(chats: Chat[]) {
  const n = new Map<string, number>();
  for (const c of chats) if (c.section) n.set(c.section, (n.get(c.section) ?? 0) + 1);
  return [...n].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

// The chats in each section, newest first, sections by name.
export function sectionGroups<C extends Chat>(chats: C[]) {
  const by = new Map<string, C[]>();
  for (const c of chats) if (c.section) by.set(c.section, [...(by.get(c.section) ?? []), c]);
  for (const l of by.values()) l.sort((a, b) => b.lastModified - a.lastModified);
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([name, chats]) => ({ name, chats }));
}

// The picker rows for a chat: the other sections with counts, then New section from the typed name.
export function sectionChoices(chats: Chat[], current: string | undefined, typed: string) {
  const list = sectionList(chats).filter((s) => s.name !== current);
  const name = sectionName(typed);
  const fresh = name && !sectionList(chats).some((s) => s.name.toLowerCase() === name.toLowerCase());
  return { list, fresh: fresh ? name : null };
}
