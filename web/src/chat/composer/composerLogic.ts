import { parseWhen, stripWhen } from '../../codex/data/tasks/engine';
import { match } from '../../workspace/FileSwitcher';
import { toolId } from '../../ops/mcpHelpers';
import { compactAt, type ChatEvent, type ChatRun, type LiveChat, type LiveNow, type RoundOutcome, type SavedSession } from '../../../../shared/protocol';
import { apiUrl, fetchJson } from '../../app/api';
import { createTerm, listTerms } from '../../workspace/termApi';
import { isBlock } from '../../../../shared/util';
import { firstRound, nextRound, roundText, runLine as roundLine } from '../../../../shared/goalText';
import { runNeedsYou } from '../../../../shared/advisors';
import { timedMeetings } from '../../../../shared/plan';
import { profileOfPath } from '../../../../shared/workspace';
import { live, type Meeting } from '../../codex/data/wiki/wiki';

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
export function turnEnd(events: ChatEvent[], label: string) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'user') break;
    if (e.kind === 'assistant' && !e.parent && e.text.trim()) return `${label}: ${e.text}`;
    if (e.kind === 'result' && e.isError) return `${label} stopped: ${e.text}`;
  }
  return `${label} finished`;
}

export const contextPercent = (context: number | null, contextWindow?: number | null) => (context === null ? null : Math.min(100, Math.round((context / compactAt(contextWindow)) * 100)));

const ENDED: Record<string, string> = { passed: 'Build cycle passed', failed: 'Build cycle stopped' };

const KIND: Record<ChatRun['kind'], string> = { loop: 'Loop', goal: 'Goal', cycle: 'Build cycle', tries: 'Tries', job: 'Job' };

export function runLine(run: ChatRun, phase: string | null = null) {
  if (run.state === 'paused') return run.why ? `Paused · ${run.why}` : 'Paused';
  if (run.kind === 'goal') return roundLine(KIND.goal, run);
  if (run.kind === 'tries') return `Tries · ${run.tries?.filter((t) => !t.dropped).length ?? 0} chats`;
  if (run.kind === 'job') return `Job · ${run.branch}`;
  if (run.kind === 'cycle') return `Build cycle · round ${run.round}/${run.max}${phase && phase !== 'passed' && phase !== 'failed' ? ` · ${phase[0].toUpperCase()}${phase.slice(1)}` : ''}`;
  return roundLine(KIND.loop, run);
}

export type ChatState = { text: string; tone: 'running' | 'needs' | 'failed' | 'warn' | 'idle' };

// The state of a chat for the header: what needs the user first, then the running turn, running agents, the run between rounds.
export function chatState(chat: Pick<LiveChat, 'pending' | 'failed' | 'stalled' | 'running' | 'status' | 'agentList'> & { run?: Pick<NonNullable<LiveChat['run']>, 'state' | 'why' | 'nextAt'> }): ChatState {
  const agents = chat.agentList?.length ?? 0;
  const { run } = chat;
  if (chat.pending > 0) return { text: 'Needs you', tone: 'needs' };
  if (chat.failed) return { text: 'Failed', tone: 'failed' };
  if (chat.stalled) return { text: 'No activity for 15 min', tone: 'failed' };
  if (chat.running) return { text: chat.status && chat.status !== 'Idle' ? chat.status : 'Working', tone: 'running' };
  if (agents) return { text: `Running · ${agents} ${agents === 1 ? 'agent' : 'agents'}`, tone: 'running' };
  if (run?.state === 'paused') return { text: run.why ? `Paused · ${run.why}` : 'Paused', tone: 'warn' };
  if (run) return { text: nextRound(run.nextAt), tone: 'idle' };
  return { text: 'Idle', tone: 'idle' };
}

export type LoopNow = { title: string; at: number | null; source: 'status' | 'round' | 'none'; next?: string; stepsLeft?: number };

// What the loop card's first row shows: the agent's status or the last round, whichever is newer. A status from before the run started is ignored.
export function loopNow(run: ChatRun, now?: LiveNow): LoopNow {
  const last = run.rounds.at(-1);
  if (now && now.at >= run.startedAt && (!last || now.at >= last.at)) {
    return { title: now.text, at: now.at, source: 'status', ...(now.next?.length && { next: now.next[0], stepsLeft: now.next.length }) };
  }
  if (last) return { title: roundText(last), at: null, source: 'round' };
  return { title: firstRound(run.nextAt), at: null, source: 'none' };
}

// How long an agent has run, as "12 min" or "1 h 5 min".
export function agentAge(startedAt: number, now: number) {
  const min = Math.max(1, Math.floor((now - startedAt) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// The prompt of a round is in the transcript; it may take a moment to show after the chat opens.
export function showTurn(id: string, tries = 20) {
  const el = document.getElementById(`turn-${id}`);
  if (el) el.scrollIntoView({ block: 'center' });
  else if (tries) setTimeout(() => showTurn(id, tries - 1), 100);
}

export const stoppedText = (run: ChatRun, running: boolean) => `${KIND[run.kind]} stopped${running && run.round > 0 && (run.kind === 'goal' || run.kind === 'loop') ? ` · round ${run.round} was running` : ''}`;

export const OUTCOME_DOT: Record<RoundOutcome, string> = { blocked: 'warn', question: 'warn', failed: 'bad', done: 'ok', quiet: '', progress: '' };

export { runNeedsYou };

export const loopOpenByDefault = (run: ChatRun, working: boolean, waiting: boolean) => working || waiting || runNeedsYou(run);

export const loopLabel = (loop: { phase: string | null; round: number; max: number }) => (loop.phase ? ENDED[loop.phase] ?? `Build cycle${loop.max > 1 ? ` · round ${loop.round}/${loop.max}` : ''}` : '');
export const fileCache = new Map<string, string[]>();

export async function terminalId(url: (path: string) => string): Promise<string | null> {
  try {
    const listed = await listTerms(url('/api/terms'));
    if (!listed.ok) return null;
    const list: Array<{ id: string }> = await listed.json();
    let term = list.at(-1);
    if (!term) {
      const created = await createTerm(url('/api/terms'));
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

// The loaded prompts and replies as Markdown, like the phone's Share chat and Goose's session export.
export function chatMarkdown(events: ChatEvent[], title: string) {
  const parts = events.flatMap((e) => (e.kind === 'user' && !e.queued ? [`**You:** ${e.text.trim()}`] : e.kind === 'assistant' && !e.parent && e.text.trim() ? [e.text.trim()] : []));
  return [`# ${title || 'Chat'}`, ...parts].join('\n\n') + '\n';
}

// A reply saved to Notes: the chat title on the first line, in the profile of the chat's folder.
export function replyNote(text: string, title: string, cwd: string) {
  return { text: `${title || 'Saved reply'}\n${text.trim()}`, profile: profileOfPath(cwd) };
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

// The mode Shift+Tab switches to: the next one the provider offers, wrapping around.
export const nextMode = (modes: { value: string }[], mode: string) => modes[(modes.findIndex((m) => m.value === mode) + 1) % modes.length].value;

// Fork chat: the new chat reads the old one's transcript (via @chat) and summarises it, so work continues from a short brief.
export const handoffText = (sessionId: string) =>
  `Summarise @chat:${sessionId} so we can continue its work in this chat: the goal, decisions made, what is done, what is still open, and the files and commands that matter. At most 15 lines. Then wait for my next message.`;
