// A comment on one line of a diff, staged in the composer and sent with the next prompt.
export type LineComment = { path: string; line: number; code: string; text: string };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export const commentChip = (c: LineComment) => `${c.path.split('/').pop()}:${c.line} ${cut(c.text, 40)}`;

export function commentPrompt(c: LineComment) {
  const code = c.code.trim();
  return `Comment on \`${c.path}:${c.line}\`${code ? ` (\`${cut(code, 200)}\`)` : ''}: ${c.text.trim()}`;
}

// The prompt as sent: the text, then one line per comment.
export const withComments = (text: string, comments: LineComment[]) => [text.trim(), ...comments.map(commentPrompt)].filter(Boolean).join('\n\n');

export const commentLabel = (line: number, staged: boolean) => (staged ? `Line ${line} · Added to prompt` : `Line ${line}`);
