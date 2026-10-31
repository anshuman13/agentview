type Row = unknown[];

const seconds = (t: unknown) => {
  const n = typeof t === 'number' ? t : Date.parse(String(t)) / 1000 || Number(t);
  return n > 1e11 ? n / 1000 : n;
};

function collect(v: unknown, out: Row[][]): void {
  if (Array.isArray(v)) {
    v.forEach((x) => collect(x, out));
    return;
  }
  if (!v || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  const vals = o.values ?? o.samples;
  if (Array.isArray(vals) && vals.every(Array.isArray)) out.push(vals as Row[]);
  else Object.values(o).forEach((x) => collect(x, out));
}

// Reads the first series of a Prometheus range result in any of the shapes the MCP returns.
export function seriesPoints(raw: unknown): [number, number][] {
  const series: Row[][] = [];
  collect(raw, series);
  const rows = series[0] ?? [];
  return rows
    .map((r): [number, number] => [seconds(r[0]), Number(r[1])])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
}
