// A brief's dismissed column: one line per dismissal ("+key\tat") or undo ("-key\tat"). Lines merge as a set,
// so dismissals made on two devices before they sync both stay, and the latest line per key decides.
const KEEP = 100;

type Line = { key: string; on: boolean; at: number; raw: string };

function parse(raw: string): Line {
  const tab = raw.lastIndexOf('\t');
  if ((raw[0] !== '+' && raw[0] !== '-') || tab < 0) return { key: raw, on: true, at: 0, raw };
  return { key: raw.slice(1, tab), on: raw[0] === '+', at: Number(raw.slice(tab + 1)) || 0, raw };
}

const linesOf = (v: string | null | undefined) => (v ?? '').split('\n').filter(Boolean).map(parse);

export function dismissedKeys(v: string | null | undefined): string[] {
  const latest = new Map<string, Line>();
  for (const l of linesOf(v)) if ((latest.get(l.key)?.at ?? -1) <= l.at) latest.set(l.key, l);
  return [...latest.values()].filter((l) => l.on).map((l) => l.key);
}

export function mergeDismissed(a: string | null | undefined, b: string | null | undefined): string | null {
  const all = new Map<string, Line>();
  for (const l of [...linesOf(a), ...linesOf(b)]) all.set(l.raw, l);
  const kept = [...all.values()].sort((x, y) => x.at - y.at).slice(-KEEP);
  return kept.map((l) => l.raw).join('\n') || null;
}

export const withDismissal = (v: string | null | undefined, key: string, on: boolean, at: number) => mergeDismissed(v, `${on ? '+' : '-'}${key}\t${at}`);
