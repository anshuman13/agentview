export const CHECK_RE = /^\s*[-*] \[([ xX])\](.*)$/gm;

const LINE_RE = new RegExp(CHECK_RE.source, 'm');

export const checkItems = (text: string | null) => [...(text ?? '').matchAll(CHECK_RE)].map((m) => ({ done: /x/i.test(m[1]), label: m[2].trim() }));

// Flips the box of the nth checklist line.
export const toggleCheck = (text: string, n: number) => {
  let i = 0;
  return text.replace(CHECK_RE, (line, box: string) => (i++ === n ? line.replace(`[${box}]`, /x/i.test(box) ? '[ ]' : '[x]') : line));
};

// Appends a new unticked line after the last checklist line, or at the end of the notes when there is none.
export const addCheck = (text: string, label: string) => {
  const line = label.trim();
  if (!line) return text;
  const lines = text.split('\n');
  const last = lines.map((l) => LINE_RE.test(l)).lastIndexOf(true);
  if (last < 0) return `${text}${text && !text.endsWith('\n') ? '\n' : ''}- [ ] ${line}`;
  lines.splice(last + 1, 0, `- [ ] ${line}`);
  return lines.join('\n');
};

// Moves checklist line `from` so it ends up as checklist line `to`; every other line stays where it is.
export const moveCheck = (text: string, from: number, to: number) => {
  const lines = text.split('\n');
  const slots = lines.flatMap((l, i) => (LINE_RE.test(l) ? [i] : []));
  if (from === to || Math.min(from, to) < 0 || Math.max(from, to) >= slots.length) return text;
  const moved = slots.map((i) => lines[i]);
  moved.splice(to, 0, ...moved.splice(from, 1));
  slots.forEach((i, k) => { lines[i] = moved[k]; });
  return lines.join('\n');
};
