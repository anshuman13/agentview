import { parseWhen, stripWhen } from '../codex/data/engine';
import { match } from '../workspace/FileSwitcher';
import { toolId } from '../ops/mcpHelpers';
import { COMPACT_AT, MAX_GOAL_ROUNDS, type Account, type ChatEvent, type SavedSession } from '../../../shared/protocol';
import { apiUrl, fetchJson } from '../app/api';
import { clock, isBlock, span } from '../../../shared/util';
import { timedMeetings } from '../../../shared/plan';
import { live, type Meeting } from '../codex/data/wiki';

type Trigger = { kind: 'command' | 'file'; start: number; query: string } | { kind: 'shell' } | null;

type Ranked<T> = { item: T; hits: number[]; score: number };

export type Use = { server: string; tool?: string };

export const MAX_ROWS = 8;
const MAX_STORED = 50;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export function triggerAt(text: string, caret: number): Trigger {
  if (text.startsWith('!')) return { kind: 'shell' };
  const before = text.slice(0, Math.min(caret, text.length));
  const m = /(?:^|\s)([/@])(\S*)$/.exec(before);
  if (!m) return null;
  return { kind: m[1] === '/' ? 'command' : 'file', start: before.length - 1 - m[2].length, query: m[2] };
}

function rank<T>(items: T[], key: (t: T) => string, query: string, limit: number): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const m = match(key(item), query);
    if (m) out.push({ item, hits: m.hits, score: m.score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const rankCommands = <T extends { name: string }>(commands: T[], query: string, limit = MAX_ROWS) => rank(commands, (c) => c.name, query, limit);

export const rankFiles = (files: string[], query: string, limit = MAX_ROWS) => rank(files, (f) => f, query, limit);

// "@chat:" lists other chats by title; picking one inserts @chat:<session id>, which the server expands to its transcript.
export const chatQuery = (t: Trigger) => (t?.kind === 'file' && t.query.startsWith('chat:') ? t.query.slice(5) : null);

export const rankChats = (chats: SavedSession[], query: string, limit = MAX_ROWS) => rank(chats.filter((c) => c.title), (c) => c.title, query, limit);

export function accept(text: string, start: number, caret: number, insert: string) {
  const next = `${text.slice(0, start)}${insert} ${text.slice(caret)}`;
  return { text: next, caret: start + insert.length + 1 };
}

export function sharedTask(text: string, now = new Date()) {
  const typed = text.trim();
  const w = parseWhen(typed, now);
  return { title: stripWhen(typed, w) || typed, at: w?.at ?? null };
}

export function currentMeeting(meetings: Meeting[], now: number) {
  const rows = timedMeetings(live(meetings)).filter((m) => !isBlock(m.id));
  const running = rows.filter((m) => m.starts_at! <= now && now < m.ends_at!).sort((a, b) => b.starts_at! - a.starts_at!);
  const soon = rows.filter((m) => m.starts_at! > now && m.starts_at! - now < 15 * 60_000).sort((a, b) => a.starts_at! - b.starts_at!);
  return running[0] ?? soon[0] ?? null;
}

export const append = (text: string, add: string) => `${text}${text && !/\s$/.test(text) ? ' ' : ''}${add}`;

export function addUse(uses: Use[], u: Use): Use[] {
  const keep = (x: Use) => x.server !== u.server || (!!u.tool && !!x.tool && x.tool !== u.tool);
  return [...uses.filter(keep), u];
}

export const useLabel = (u: Use) => (u.tool ? toolId(u.server, u.tool) : u.server);

export function withUses(text: string, uses: Use[]) {
  if (!uses.length || text.startsWith('/')) return text;
  const names = uses.map((u) => (u.tool ? `the ${toolId(u.server, u.tool)} tool` : `the ${u.server} MCP server`));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${text}\n\nUse ${list} for this.`;
}

export function buildHistory(events: ChatEvent[], stored: string[]) {
  const local = events.filter((e) => e.kind === 'user').map((e) => e.text.trim()).reverse();
  const out: string[] = [];
  for (const t of [...local, ...[...stored].reverse()]) {
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function ghostFor(text: string, history: string[]) {
  if (text.length < 3) return '';
  const hit = history.find((h) => h.length > text.length && h.startsWith(text));
  return hit ? hit.slice(text.length) : '';
}

export const remember = (text: string, stored: string[], max = MAX_STORED) => [...stored.filter((t) => t !== text), text].slice(-max);

export function filesEdited(events: ChatEvent[]) {
  const paths = new Set<string>();
  for (const e of events) {
    if (e.kind === 'tool_use' && EDIT_TOOLS.has(e.name) && typeof e.input.file_path === 'string') paths.add(e.input.file_path);
  }
  return paths.size;
}

// What a screen reader hears when a turn ends: the last top-level reply since the prompt, else the error.
export function turnEnd(events: ChatEvent[]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'user') break;
    if (e.kind === 'assistant' && !e.parent && e.text.trim()) return `Claude: ${e.text}`;
    if (e.kind === 'result' && e.isError) return `Claude stopped: ${e.text}`;
  }
  return 'Claude finished';
}

export const contextPercent = (context: number | null) => (context === null ? null : Math.min(100, Math.round((context / COMPACT_AT) * 100)));

const ENDED: Record<string, string> = { passed: 'Build cycle passed', failed: 'Build cycle stopped' };

const once = (r: { every: number; until: number | null; nextAt: number | null }) => !r.every && r.until !== null && r.nextAt !== null && r.until - r.nextAt <= 1000;
export const repeatLabel = (r: { every: number; until: number | null; round: number; nextAt: number | null; goal?: string }) =>
  r.goal ? `Goal check ${r.round} of ${MAX_GOAL_ROUNDS}: ${r.goal}` : once(r) ? `Continues once at ${clock(r.nextAt!)}` : `Loop round ${r.round}, ${r.every ? `every ${span(r.every)}` : 'back to back'}${r.until ? ` until ${clock(r.until)}` : ''}`;

export const repeatPill = (r: { every: number; until: number | null; round: number; nextAt: number | null; goal?: string }) =>
  r.goal ? `Goal ${r.round}/${MAX_GOAL_ROUNDS}${r.nextAt ? ` · next ${clock(r.nextAt)}` : ''}` : once(r) ? `Continue at ${clock(r.nextAt!)}` : `Loop ${r.round}${r.nextAt ? ` · next ${clock(r.nextAt)}` : ''}${r.until ? ` · until ${clock(r.until)}` : ''}`;
export const loopLabel = (loop: { phase: string | null; round: number; max: number }) => (loop.phase ? ENDED[loop.phase] ?? `Build cycle${loop.max > 1 ? ` · round ${loop.round}/${loop.max}` : ''}` : '');
export const fileCache = new Map<string, string[]>();

export async function terminalId(url: (path: string) => string): Promise<string | null> {
  try {
    const listed = await fetch(url('/api/terms'));
    if (!listed.ok) return null;
    const list: Array<{ id: string }> = await listed.json();
    let term = list.at(-1);
    if (!term) {
      const created = await fetch(url('/api/terms'), { method: 'POST' });
      if (!created.ok) return null;
      term = await created.json();
    }
    return term?.id ?? null;
  } catch {
    return null;
  }
}

export const STORED_KEY = 'agentview.prompts';

const draftKey = (chat: string) => `agentview.draft.${chat}`;

export function readDraft(chat: string) {
  try {
    return localStorage.getItem(draftKey(chat)) ?? '';
  } catch {
    return '';
  }
}

// The first non-empty line of a draft, for the sidebar's Draft: line.
export const draftLine = (text: string) => text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

export function saveDraft(chat: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(chat), text);
    else localStorage.removeItem(draftKey(chat));
  } catch {}
}

export const uploadPaste = (f: File) => fetchJson<{ path: string }>(apiUrl(`/api/paste?name=${encodeURIComponent(f.name || 'pasted')}`), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });

const CONFIG_DIR: Partial<Record<Account, string>> = { alt: '~/.claude-alt', alt2: '~/.claude-alt2' };
const shQuote = (s: string) => (/^[\w./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// A shell line that continues this chat in the Claude CLI, on the same account.
// The loaded prompts and replies as Markdown, like the phone's Share chat and Goose's session export.
export function chatMarkdown(events: ChatEvent[], title: string) {
  const parts = events.flatMap((e) => (e.kind === 'user' && !e.queued ? [`**You:** ${e.text.trim()}`] : e.kind === 'assistant' && !e.parent && e.text.trim() ? [e.text.trim()] : []));
  return [`# ${title || 'Chat'}`, ...parts].join('\n\n') + '\n';
}

// A reply saved to Notes: the chat title on the first line, in the profile of the chat's folder.
export function replyNote(text: string, title: string, cwd: string) {
  return { text: `${title || 'Saved reply'}\n${text.trim()}`, profile: cwd.includes('/workspace_personal/') || cwd.endsWith('/workspace_personal') ? ('personal' as const) : ('work' as const) };
}

// A Markdown quote of a reply to answer it in the next prompt, like Slack's reply with quote: up to 300 characters, cut at a word.
export function quoteReply(text: string, max = 300) {
  const t = text.trim();
  const cut = t.length <= max ? t : `${t.slice(0, max).slice(0, t.slice(0, max).lastIndexOf(' ')).trimEnd()}…`;
  return `${cut.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}\n\n`;
}

// Slack's "Remind me about this", the same choices as the phone's chat menu.
export function remindChoices(now: number) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [{ label: 'In 1 hour', at: now + 3_600_000 }, { label: 'In 3 hours', at: now + 3 * 3_600_000 }, { label: 'Tomorrow at 9:00', at: tomorrow.getTime() }];
}

export function resumeCommand(cwd: string, sessionId: string, account: Account) {
  const dir = CONFIG_DIR[account];
  return `cd ${shQuote(cwd)} && ${dir ? `CLAUDE_CONFIG_DIR=${dir} ` : ''}claude --resume ${sessionId}`;
}
