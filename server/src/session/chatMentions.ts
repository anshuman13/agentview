import { transcriptPath as registryPath } from '../agent/registry.js';

const MENTION = /@chat:([0-9a-f-]{36})\b/g;

// "@chat:<session id>" in a prompt points the agent at that chat's transcript, so it can read what was said and done there.
export function expandChatMentions(text: string, transcriptPath: (id: string) => string | null = registryPath) {
  const ids = [...new Set([...text.matchAll(MENTION)].map((m) => m[1]))];
  if (!ids.length) return text;
  const lines = ids.map((id) => {
    const file = transcriptPath(id);
    return file ? `@chat:${id} is another chat; its transcript is ${file} (JSON lines, read the user and assistant messages).` : `@chat:${id} was not found.`;
  });
  return `${text}\n\n${lines.join('\n')}`;
}
