export type Commit = { hash: string; subject: string };

const COMMIT = /^\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/m;
// The output of a git commit holds the `[branch abc1234] subject` line git prints, or with -q the
// `abc1234 subject` line of a git log --oneline after it.
const ONELINE = /^([0-9a-f]{7,40}) (.+)$/m;

export function commitOf(text: string): Commit | null {
  const m = text.match(COMMIT) ?? text.match(ONELINE);
  return m ? { hash: m[1].slice(0, 7), subject: m[2].trim() } : null;
}

// The part of the text around the word at index i, cut at word boundaries.
export function snippetAround(text: string, i: number) {
  const from = Math.max(0, i - 40);
  const space = text.indexOf(' ', from);
  const start = from > 0 && space >= 0 && space < i ? space + 1 : from;
  const cut = text.lastIndexOf(' ', start + 160);
  const end = start + 160 >= text.length ? text.length : cut > i ? cut : start + 160;
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
