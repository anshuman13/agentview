export const CHECK_RE = /^\s*[-*] \[([ xX])\](.*)$/gm;

export const checkItems = (text: string | null) => [...(text ?? '').matchAll(CHECK_RE)].map((m) => ({ done: /x/i.test(m[1]), label: m[2].trim() }));

// Flips the box of the nth checklist line.
export const toggleCheck = (text: string, n: number) => {
  let i = 0;
  return text.replace(CHECK_RE, (line, box: string) => (i++ === n ? line.replace(`[${box}]`, /x/i.test(box) ? '[ ]' : '[x]') : line));
};
