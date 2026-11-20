// The saved chat id of an absolute or relative `?session=<id>` link, else null; shared/fixtures/chat-session-of.json holds the cases.
export const chatSessionOf = (url: string | null | undefined) => {
  const id = /[?&]session=([^&#]+)/.exec(url ?? '')?.[1];
  if (!id) return null;
  try { return decodeURIComponent(id); } catch { return id; }
};
