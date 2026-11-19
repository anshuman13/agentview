// The prompt Ask Claude sends for a passage selected in a rendered Markdown file. Android DocEdit.kt says the same.
export function docAskPrompt(path: string, quote: string, ask: string) {
  const quoted = quote.trim().split('\n').map((l) => `> ${l}`).join('\n');
  return `In ${path}, about this part:\n\n${quoted}\n\n${ask.trim()}\n\nEdit the file in place and leave the rest as it is.`;
}

// Puts an edited block back into the file, keeping the blank lines after it. Null when the file changed under the edit.
export function replaceBlock(text: string, block: { start: number; raw: string }, value: string): string | null {
  if (text.slice(block.start, block.start + block.raw.length) !== block.raw) return null;
  const tail = /\s*$/.exec(block.raw)![0];
  return text.slice(0, block.start) + value.replace(/\s+$/, '') + tail + text.slice(block.start + block.raw.length);
}
