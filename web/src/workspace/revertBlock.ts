import { fileDiff, revertBlock } from '../../../shared/lineDiff';

export { revertBlock };

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
