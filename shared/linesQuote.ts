// The composer text for lines picked in a file: `path:start-end`, then the lines as a quote. Android: workspace/FilesLogic.kt linesQuote.
export function linesQuote(path: string, start: number, end: number, text: string) {
  const where = start === end ? `${start}` : `${start}-${end}`;
  const lines = text.replace(/\n+$/, '').split('\n').map((l) => (l.trim() ? `> ${l.trimEnd()}` : '>'));
  return `\`${path}:${where}\`\n${lines.join('\n')}`;
}
