import type { SavedSession } from '../../../../shared/protocol';

type Chat = Pick<SavedSession, 'sessionId' | 'title' | 'parentId' | 'spawnedBy'>;

// A build chat's link back to the chat that started it: the parent row's title and its root session, which opens the parent's latest sub-chat.
export function startedFrom(chats: Chat[], sessionId: string | null | undefined): { text: string; sessionId: string } | null {
  if (!sessionId) return null;
  const byId = new Map(chats.map((c) => [c.sessionId, c]));
  const self = byId.get(sessionId);
  const root = byId.get(self?.parentId ?? sessionId);
  const parentId = root?.spawnedBy;
  if (!parentId) return null;
  const at = byId.get(parentId);
  const parent = byId.get(at?.parentId ?? parentId) ?? at;
  return { text: `Started from ${parent?.title || 'another chat'}`, sessionId: parent?.sessionId ?? parentId };
}
