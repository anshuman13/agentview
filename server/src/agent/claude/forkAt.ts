import { forkSession, getSessionMessages, type SessionMessage } from '@anthropic-ai/claude-agent-sdk';

const texts = (m: SessionMessage): string[] => {
  const content = (m.message as { content?: unknown })?.content;
  return Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => String(b.text).trim()) : [];
};

// The saved message a reply came from: by its uuid for a reply read from the transcript, else by its text for a streamed one.
export function replyUuid(msgs: SessionMessage[], reply: { id: string; text: string }) {
  const uuid = reply.id.replace(/:\d+$/, '');
  if (msgs.some((m) => m.uuid === uuid)) return uuid;
  const text = reply.text.trim();
  return [...msgs].reverse().find((m) => m.type === 'assistant' && texts(m).includes(text))?.uuid ?? null;
}

// Copies a session up to and with a reply into a new session; returns its id.
export async function forkAt(sessionId: string, cwd: string, reply: { id: string; text: string }, title?: string) {
  const upToMessageId = replyUuid(await getSessionMessages(sessionId, { dir: cwd }), reply);
  if (!upToMessageId) throw new Error('That reply is not saved yet');
  return (await forkSession(sessionId, { dir: cwd, upToMessageId, title })).sessionId;
}
