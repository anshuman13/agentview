import { safeHref } from '../../ui/util';

// Top-level bullets under the brief's "Needs you" heading: the linked or bold title and the first sentence after it.
export function needsYou(text: string) {
  const out: { title: string; url: string | null; why: string }[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (!bullet) {
      if (/^\s/.test(line)) continue;
      if (/needs you/i.test(line)) inside = true;
      else if (/^#{1,6}\s|^\*\*[^*]+\*\*:?\s*$/.test(line)) inside = false;
      continue;
    }
    if (!inside) continue;
    const m = bullet[1].match(/^(?:\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)|\*\*([^*]+)\*\*)\s*:?\s*(.*)$/);
    const title = m ? (m[1] ?? m[3]) : bullet[1].split(':')[0];
    const rest = m ? m[4] : bullet[1].slice(title.length + 1);
    const url = safeHref(m?.[2]) ?? null;
    out.push({ title: title.trim(), url, why: rest.trim().split(/(?<=[.!?])\s/)[0] });
  }
  return out;
}
