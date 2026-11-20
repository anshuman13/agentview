// The repo CLAUDE.md with one more bullet; null when the rule is empty. A missing file reads as empty text.
export function appendRule(text: string, rule: string): string | null {
  const line = rule.replace(/\s+/g, ' ').trim();
  if (!line) return null;
  const head = text && !text.endsWith('\n') ? `${text}\n` : text;
  return `${head}- ${line}\n`;
}

// The text without the last "- rule" bullet, or null when no bullet has that line. Earlier and later edits stay.
export function removeRule(text: string, rule: string): string | null {
  const lines = text.split('\n');
  const at = lines.lastIndexOf(`- ${rule.replace(/\s+/g, ' ').trim()}`);
  if (at < 0) return null;
  lines.splice(at, 1);
  return lines.join('\n');
}
