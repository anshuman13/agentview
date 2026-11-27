export const FADE_MS = 250;

export type Tail = { start: number; at: number };
export type FadeRange = { start: number; end: number; delay: number };

// Each chunk of streamed text fades from the moment it arrived; a re-render keeps it at the same point of its fade.
// prevLen is null on a block's first render: text already there when it mounts counts as shown.
export function nextTails(tails: Tail[], prevLen: number | null, len: number, now: number): Tail[] {
  if (prevLen === null) return [];
  const live = tails.filter((t) => now - t.at < FADE_MS && t.start < len);
  return len > prevLen ? [...live, { start: prevLen, at: now }] : live;
}

// Replies that started streaming while their chat was showing: ids missing from what the transcript had already rendered.
// known is null until the transcript first shows items, so a chat opened mid-reply has none.
export function freshReplies(known: Set<string> | null, items: { kind: string; id: string; streaming?: boolean }[]): Set<string> {
  if (!known) return new Set();
  return new Set(items.filter((it) => it.kind === 'assistant' && it.streaming && !known.has(it.id)).map((it) => it.id));
}

export function knownIds(known: Set<string> | null, items: { id: string }[]): Set<string> | null {
  if (!items.length) return known;
  const next = known ?? new Set<string>();
  for (const it of items) next.add(it.id);
  return next;
}

export function fadeRanges(tails: Tail[], len: number, now: number): FadeRange[] {
  return tails.map((t, i) => ({ start: t.start, end: Math.min(tails[i + 1]?.start ?? len, len), delay: t.at - now })).filter((r) => r.end > r.start);
}

export function wrapRanges(root: HTMLElement, ranges: FadeRange[]) {
  if (!ranges.length) return;
  const texts: { node: Text; start: number }[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    texts.push({ node: n, start: pos });
    pos += n.data.length;
  }
  for (const r of [...ranges].reverse()) {
    for (const { node, start } of texts) {
      const from = Math.max(r.start - start, 0);
      const to = Math.min(r.end - start, node.data.length);
      if (from >= to || !node.parentNode) continue;
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const span = document.createElement('span');
      span.className = 'md-new';
      span.style.animationDelay = `${r.delay}ms`;
      range.surroundContents(span);
    }
  }
}
