import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { CLAUDE_DIR } from './history.js';

export type MessageHit = { sessionId: string; role: 'user' | 'assistant'; text: string; at: string };

function messageText(o: { type?: string; isMeta?: boolean; isCompactSummary?: boolean; message?: { content?: unknown } }) {
  if ((o.type !== 'user' && o.type !== 'assistant') || o.isMeta || o.isCompactSummary) return '';
  const c = o.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

// One transcript line as a hit when its prompt or reply text holds every word; the text is cut to the part around the first word.
export function lineHit(line: string, words: string[]): MessageHit | null {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const text = messageText(o).replace(/\s+/g, ' ').trim();
  if (!text || text.startsWith('<') || !o.sessionId) return null;
  const low = text.toLowerCase();
  if (!words.every((w) => low.includes(w))) return null;
  const i = low.indexOf(words[0]);
  const from = Math.max(0, i - 40);
  const space = text.indexOf(' ', from);
  const start = from > 0 && space >= 0 && space < i ? space + 1 : from;
  const cut = text.lastIndexOf(' ', start + 160);
  const end = start + 160 >= text.length ? text.length : cut > i ? cut : start + 160;
  const snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  return { sessionId: o.sessionId, role: o.type, text: snippet, at: o.timestamp ?? '' };
}

// Prompts and replies across all chats that hold every word of the query, newest first, at most 3 per chat.
export async function searchMessages(query: string, dir = CLAUDE_DIR, max = 50): Promise<MessageHit[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const root = path.join(dir, 'projects');
  const files = (await Promise.all((await readdir(root).catch(() => [] as string[])).map(async (d) =>
    (await readdir(path.join(root, d)).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(root, d, f))))).flat();
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  const hits: MessageHit[] = [];
  for (const f of files) {
    const s = await readFile(f, 'utf8').catch(() => '');
    const re = new RegExp(longest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    for (let m; (m = re.exec(s)); ) {
      const end = s.indexOf('\n', m.index);
      const hit = lineHit(s.slice(s.lastIndexOf('\n', m.index) + 1, end < 0 ? s.length : end), words);
      if (hit) hits.push(hit);
      if (end < 0) break;
      re.lastIndex = end;
    }
  }
  hits.sort((a, b) => b.at.localeCompare(a.at));
  const per = new Map<string, number>();
  return hits.filter((h) => { const n = (per.get(h.sessionId) ?? 0) + 1; per.set(h.sessionId, n); return n <= 3; }).slice(0, max);
}
