export type DiffLine = [' ' | '-' | '+', string];

export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a ? a.split('\n') : [];
  const y = b ? b.split('\n') : [];
  const n = x.length, m = y.length;
  if (n * m > 250_000) return [...x.map((l): DiffLine => ['-', l]), ...y.map((l): DiffLine => ['+', l])];
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) out.push([' ', x[i++]]), j++;
    else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) out.push(['-', x[i++]]);
    else out.push(['+', y[j++]]);
  }
  return out;
}

// The file against another text as diff lines; the unchanged head and tail skip the line-by-line comparison.
export function fileDiff(original: string, content: string): DiffLine[] {
  const a = original.split('\n');
  const b = content.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const mid = head < a.length - tail || head < b.length - tail ? lineDiff(a.slice(head, a.length - tail).join('\n'), b.slice(head, b.length - tail).join('\n')) : [];
  return [...a.slice(0, head).map((l): DiffLine => [' ', l]), ...mid, ...a.slice(a.length - tail).map((l): DiffLine => [' ', l])];
}

// The file text with change block k (a run of - and + lines between unchanged ones, from 0) put back to the original lines.
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
