import { lineDiff, type DiffLine } from '../chat/cards/Pending';

// The file against its committed text as diff lines; the unchanged head and tail skip the line-by-line comparison.
function fileDiff(original: string, content: string): DiffLine[] {
  const a = original.split('\n');
  const b = content.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const mid = head < a.length - tail || head < b.length - tail ? lineDiff(a.slice(head, a.length - tail).join('\n'), b.slice(head, b.length - tail).join('\n')) : [];
  return [...a.slice(0, head).map((l): DiffLine => [' ', l]), ...mid, ...a.slice(a.length - tail).map((l): DiffLine => [' ', l])];
}

// The file text with change block k (a run of - and + lines between unchanged ones, from 0) put back to its committed lines.
export function revertBlock(original: string, content: string, k: number): string {
  const out: string[] = [];
  let block = -1;
  let inBlock = false;
  for (const [mark, text] of fileDiff(original, content)) {
    if (mark === ' ') {
      inBlock = false;
      out.push(text);
      continue;
    }
    if (!inBlock) {
      block++;
      inBlock = true;
    }
    if (mark === (block === k ? '-' : '+')) out.push(text);
  }
  return out.join('\n');
}

// The change block at a line of the new file, or of the removed lines shown above it; -1 for an unchanged line.
export function blockAt(original: string, content: string, line: number, removed: boolean): number {
  let block = -1;
  let inBlock = false;
  let now = 0;
  for (const [mark] of fileDiff(original, content)) {
    if (mark === ' ') {
      inBlock = false;
      now++;
      continue;
    }
    if (!inBlock) {
      block++;
      inBlock = true;
    }
    if (mark === '+') now++;
    if (mark === (removed ? '-' : '+') && (removed ? now + 1 : now) === line) return block;
  }
  return -1;
}
