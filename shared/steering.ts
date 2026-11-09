// The repo CLAUDE.md with one more bullet; null when the rule is empty. A missing file reads as empty text.
export function appendRule(text: string, rule: string): string | null {
  const line = rule.replace(/\s+/g, ' ').trim();
  if (!line) return null;
  const head = text && !text.endsWith('\n') ? `${text}\n` : text;
  return `${head}- ${line}\n`;
}
