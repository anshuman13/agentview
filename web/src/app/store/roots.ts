// Each sub-chat's root session id, from the sessions list, so seen, mute and row actions land on the chat row.
let roots = new Map<string, string>();

export const setRoots = (chats: { sessionId: string; parentId?: string }[]) => {
  roots = new Map(chats.flatMap((c) => (c.parentId ? [[c.sessionId, c.parentId] as const] : [])));
};

export const rootOf = <T extends string | null | undefined>(id: T): T => ((id && roots.get(id)) ?? id) as T;
