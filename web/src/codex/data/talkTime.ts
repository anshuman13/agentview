type Speaker = { name: string; words: number; share: number };

const STAMP = /^\[?\(?\d{1,2}:\d{2}(:\d{2})?\)?\]?$/;
const NAME = /^\p{Lu}[\p{L}'.-]*(?: [\p{L}'.-]+){0,3}$/u;
const HEADING = /^\W*(transcript|transkripsjon)\W*$/i;
const count = (s: string) => s.split(/\s+/).filter(Boolean).length;
const clean = (s: string) => s.replace(/^(?:#+|[-*•])\s+/, '').replace(/[*_]/g, '').trim();

// Words per speaker after one label: "Name: text" lines, or a name line with the text on the lines after it.
function tally(lines: string[], label: (i: number) => { name: string; rest: string } | null) {
  const words = new Map<string, number>();
  let who: string | null = null;
  lines.forEach((line, i) => {
    const l = label(i);
    if (l) who = l.name;
    const n = count(l ? l.rest : line);
    if (who && n) words.set(who, (words.get(who) ?? 0) + n);
  });
  return words;
}

// Share of talk time by words spoken, from the transcript part of a Gemini doc, most first. Without a transcript heading, a
// "Name: text" label counts only when it repeats, so a one-off "Summary: ..." line is not a speaker.
export function talkTime(text: string): Speaker[] {
  const all = text.split('\n').map(clean);
  const start = all.reduce((at, l, i) => (HEADING.test(l) ? i : at), -1);
  const lines = all.slice(start + 1).filter((l) => l && !STAMP.test(l));
  const labels = lines.map((l) => {
    const m = /^([^:]{1,40}):\s*(.*)$/.exec(l);
    return m && NAME.test(m[1].trim()) ? { name: m[1].trim(), rest: m[2] } : null;
  });
  const said = new Map<string, number>();
  labels.forEach((l) => l && said.set(l.name, (said.get(l.name) ?? 0) + 1));
  const colon = tally(lines, (i) => (labels[i] && (start >= 0 || said.get(labels[i]!.name)! > 1) ? labels[i] : null));
  const seen = new Map<string, number>();
  const isName = (i: number) => NAME.test(lines[i]) && i + 1 < lines.length && !NAME.test(lines[i + 1]);
  lines.forEach((l, i) => isName(i) && seen.set(l, (seen.get(l) ?? 0) + 1));
  const block = tally(lines, (i) => (isName(i) && seen.get(lines[i])! > 1 ? { name: lines[i], rest: '' } : null));
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const words = sum(colon) >= sum(block) ? colon : block;
  const total = sum(words);
  return [...words].map(([name, n]) => ({ name, words: n, share: n / total })).sort((a, b) => b.words - a.words);
}
