export const MODE_HINTS: Record<string, string> = {
  auto: 'Auto mode asks only for risky actions',
  default: 'Default mode asks before edits and commands',
  acceptEdits: 'Accept edits mode asks before commands, not file edits',
  plan: 'Plan mode asks before it starts building',
};

const QUOTE_MAX = 80;

// The plan's blocks split at blank lines, leaving fenced code whole.
export function planParagraphs(plan: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  for (const line of plan.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && !line.trim()) {
      if (cur.length) out.push(cur.join('\n'));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

function planQuote(paragraph: string) {
  const flat = paragraph.replace(/\s+/g, ' ').trim();
  return `> ${flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX).trimEnd()}…` : flat}`;
}

// One message quoting each commented paragraph, then the comment; empty when there are none.
export function planFeedback(paragraphs: string[], notes: Record<number, string>) {
  const parts = paragraphs.flatMap((p, i) => {
    const note = notes[i]?.trim();
    return note ? [`${planQuote(p)}\n${note}`] : [];
  });
  return parts.length ? `Comments on the plan:\n\n${parts.join('\n\n')}` : '';
}

// The command of a blocked Bash rule, unescaped; any other rule as it is.
export function blockedRule(rule: string) {
  return rule.startsWith('Bash(') ? rule.slice(5, -1).replace(/\\([\\()])/g, '$1') : rule;
}
