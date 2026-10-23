type Chat = { id: string; state: { session: { sessionId: string | null } } };

// The open chat a client means: by chat id, then by Claude session id. Never some other chat.
export function findChat<T extends Chat>(chats: Iterable<T>, to: { chat?: string | null; session?: string | null }) {
  const list = [...chats];
  return list.find((c) => to.chat && c.id === to.chat) ?? list.find((c) => to.session && c.state.session.sessionId === to.session);
}

// "epoch:seq" from a reconnecting client.
export function parseSince(v: string | null) {
  const m = /^([\w-]{1,64}):(\d{1,12})$/.exec(v ?? '');
  return m ? { epoch: m[1], seq: Number(m[2]) } : null;
}
