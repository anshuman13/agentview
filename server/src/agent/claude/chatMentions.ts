import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from './history.js';

const MENTION = /@chat:([0-9a-f-]{36})\b/g;

function transcript(id: string, root: string) {
  for (const d of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, d.name, `${id}.jsonl`);
    if (d.isDirectory() && existsSync(file)) return file;
  }
  return null;
}

// "@chat:<session id>" in a prompt points Claude at that chat's transcript, so it can read what was said and done there.
export function expandChatMentions(text: string, root = path.join(CLAUDE_DIR, 'projects')) {
  const ids = [...new Set([...text.matchAll(MENTION)].map((m) => m[1]))];
  if (!ids.length || !existsSync(root)) return text;
  const lines = ids.map((id) => {
    const file = transcript(id, root);
    return file ? `@chat:${id} is another chat; its transcript is ${file} (JSON lines, read the user and assistant messages).` : `@chat:${id} was not found.`;
  });
  return `${text}\n\n${lines.join('\n')}`;
}
