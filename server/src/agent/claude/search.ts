import os from 'node:os';
import path from 'node:path';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { configDir, loggedInAccounts, profileOf } from './accounts.js';
import { listBin } from './bin.js';
import { CLAUDE_DIR } from './history.js';
import { listSessions } from './sessions.js';
import { homeRelative } from '../../settings.js';

export type MessageHit = { sessionId: string; role: 'user' | 'assistant'; text: string; at: string };

function messageText(o: { type?: string; isMeta?: boolean; isCompactSummary?: boolean; message?: { content?: unknown } }) {
  if ((o.type !== 'user' && o.type !== 'assistant') || o.isMeta || o.isCompactSummary) return '';
  const c = o.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

// A transcript line as its session, role, time and one-line prompt or reply text; null for anything else.
function messageLine(line: string) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const text = messageText(o).replace(/\s+/g, ' ').trim();
  if (!text || text.startsWith('<') || !o.sessionId) return null;
  return { sessionId: o.sessionId as string, role: o.type as 'user' | 'assistant', text, at: (o.timestamp ?? '') as string };
}

// The part of the text around the word at index i, cut at word boundaries.
function snippetAround(text: string, i: number) {
  const from = Math.max(0, i - 40);
  const space = text.indexOf(' ', from);
  const start = from > 0 && space >= 0 && space < i ? space + 1 : from;
  const cut = text.lastIndexOf(' ', start + 160);
  const end = start + 160 >= text.length ? text.length : cut > i ? cut : start + 160;
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// One transcript line as a hit when its prompt or reply text holds every word; the text is cut to the part around the first word.
export function lineHit(line: string, words: string[]): MessageHit | null {
  const m = messageLine(line);
  if (!m) return null;
  const low = m.text.toLowerCase();
  if (!words.every((w) => low.includes(w))) return null;
  return { sessionId: m.sessionId, role: m.role, text: snippetAround(m.text, low.indexOf(words[0])), at: m.at };
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

type IndexedLine = { text: string; low: string; at: string };
type IndexedChat = { mtime: number; size: number; sessionId: string; cwd: string; first: string; lines: IndexedLine[] };

const index = new Map<string, IndexedChat>();

async function indexFile(file: string, mtime: number, size: number, read: typeof readFile): Promise<IndexedChat> {
  const chat: IndexedChat = { mtime, size, sessionId: path.basename(file, '.jsonl'), cwd: '', first: '', lines: [] };
  let sid = '';
  for (const line of (await read(file, 'utf8')).split('\n')) {
    if (!chat.cwd && line.includes('"cwd"')) {
      try { chat.cwd = JSON.parse(line).cwd ?? ''; } catch { /* not a json line */ }
    }
    const m = messageLine(line);
    if (!m) continue;
    sid ||= m.sessionId;
    if (!chat.first && m.role === 'user') chat.first = m.text;
    chat.lines.push({ text: m.text, low: m.text.toLowerCase(), at: m.at });
  }
  if (sid) chat.sessionId = sid;
  return chat;
}

type ChatSearchDeps = {
  dirs: () => string[];
  binned: () => Promise<string[]>;
  titles: () => Promise<Map<string, string>>;
  read: typeof readFile;
};

const defaultDeps: ChatSearchDeps = {
  dirs: () => [CLAUDE_DIR, ...loggedInAccounts().map(configDir).filter((d): d is string => !!d)],
  binned: async () => (await listBin()).map((b) => b.sessionId),
  titles: async () => new Map((await listSessions({ limit: 1000 })).map((s) => [s.sessionId, s.summary ?? ''])),
  read: readFile,
};

async function refreshIndex(dirs: string[], read: typeof readFile) {
  const roots = new Set<string>();
  for (const dir of dirs) roots.add(await realpath(path.join(dir, 'projects')).catch(() => ''));
  roots.delete('');
  const seen = new Set<string>();
  for (const root of roots) {
    for (const sub of await readdir(root).catch(() => [] as string[])) {
      for (const f of (await readdir(path.join(root, sub)).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl'))) {
        const file = path.join(root, sub, f);
        try {
          const key = await realpath(file);
          if (seen.has(key)) continue;
          const st = await stat(file);
          seen.add(key);
          const cur = index.get(key);
          if (!cur || cur.mtime !== st.mtimeMs || cur.size !== st.size) index.set(key, await indexFile(file, st.mtimeMs, st.size, read));
        } catch { /* unreadable file */ }
      }
    }
  }
  for (const key of index.keys()) if (!seen.has(key)) index.delete(key);
}

// Past chats of the caller's profile ranked by how many query words they hold, as a text block for the agent.
export async function searchChats(query: string, cwd: string, self: string | null, deps: Partial<ChatSearchDeps> = {}): Promise<string> {
  const d = { ...defaultDeps, ...deps };
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return 'Give at least one word to search for.';
  await refreshIndex(d.dirs(), d.read);
  const [binned, titles] = await Promise.all([d.binned().catch(() => [] as string[]), d.titles().catch(() => new Map<string, string>())]);
  const skip = new Set(binned);
  if (self) skip.add(self);
  const profile = profileOf(cwd);
  const ranked: { chat: IndexedChat; distinct: number; lines: number; newest: string; best: IndexedLine; bestWords: string[] }[] = [];
  for (const chat of index.values()) {
    if (skip.has(chat.sessionId) || !chat.cwd || profileOf(chat.cwd) !== profile) continue;
    const all = new Set<string>();
    let lines = 0, newest = '', best: IndexedLine | null = null, bestWords: string[] = [];
    for (const l of chat.lines) {
      const hit = words.filter((w) => l.low.includes(w));
      if (!hit.length) continue;
      hit.forEach((w) => all.add(w));
      lines++;
      if (l.at > newest) newest = l.at;
      if (!best || hit.length > bestWords.length || (hit.length === bestWords.length && l.at > best.at)) { best = l; bestWords = hit; }
    }
    if (best) ranked.push({ chat, distinct: all.size, lines, newest, best, bestWords });
  }
  ranked.sort((a, b) => b.distinct - a.distinct || b.lines - a.lines || b.newest.localeCompare(a.newest));
  if (!ranked.length) return 'No past chats match.';
  return ranked.slice(0, 8).map(({ chat, best, bestWords }) => {
    const title = titles.get(chat.sessionId) || chat.first.slice(0, 80) || 'Untitled';
    return `- ${title} | ${homeRelative(chat.cwd)} | ${best.at.slice(0, 10)} | ${chat.sessionId}\n  ${snippetAround(best.text, best.low.indexOf(bestWords[0]))}`;
  }).join('\n');
}
