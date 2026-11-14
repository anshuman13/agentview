export const exploreSet = new Set(['Read', 'Grep', 'Glob', 'LS']);

export type ExploreRow = { name: string | null; ok: boolean };

export function exploreRunsOf(rows: ExploreRow[], min = 3) {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  const close = (end: number) => { if (start >= 0 && end - start >= min) runs.push({ start, end }); start = -1; };
  rows.forEach((r, i) => {
    if (r.name && exploreSet.has(r.name) && r.ok) { if (start < 0) start = i; }
    else close(i);
  });
  close(rows.length);
  return runs;
}

export function exploreLabelOf(names: string[]) {
  const reads = names.filter((n) => n === 'Read').length;
  const searches = names.length - reads;
  return [reads && `${reads} ${reads === 1 ? 'file' : 'files'}`, searches && `${searches} ${searches === 1 ? 'search' : 'searches'}`].filter(Boolean).join(', ');
}
