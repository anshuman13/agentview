import { match } from '../workspace/FileSwitcher';
import { toolId } from '../ops/mcpHelpers';
import { COMPACT_AT, MAX_GOAL_ROUNDS, type ChatEvent } from '../../../shared/protocol';
import { clock, span } from '../../../shared/util';

export type Trigger = { kind: 'command' | 'file'; start: number; query: string } | { kind: 'shell' } | null;

export type Ranked<T> = { item: T; hits: number[]; score: number };

export type Use = { server: string; tool?: string };

export const MAX_ROWS = 8;
export const MAX_STORED = 50;
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

export function accept(text: string, start: number, caret: number, insert: string) {
  const next = `${text.slice(0, start)}${insert} ${text.slice(caret)}`;
  return { text: next, caret: start + insert.length + 1 };
}

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

export const contextPercent = (context: number | null) => (context === null ? null : Math.min(100, Math.round((context / COMPACT_AT) * 100)));

const PHASES: Record<string, string> = { plan: 'Planning with Opus', build: 'Building with Opus', test: 'Testing with Sonnet', passed: 'Loop passed', failed: 'Loop stopped' };

const once = (r: { every: number; until: number | null; nextAt: number | null }) => !r.every && r.until !== null && r.nextAt !== null && r.until - r.nextAt <= 1000;
export const repeatLabel = (r: { every: number; until: number | null; round: number; nextAt: number | null; goal?: string }) =>
  r.goal ? `Goal check ${r.round} of ${MAX_GOAL_ROUNDS}: ${r.goal}` : once(r) ? `Continues once at ${clock(r.nextAt!)}` : `Loop round ${r.round}, ${r.every ? `every ${span(r.every)}` : 'back to back'}${r.until ? ` until ${clock(r.until)}` : ''}`;

export const repeatPill = (r: { every: number; until: number | null; round: number; nextAt: number | null; goal?: string }) =>
  r.goal ? `Goal ${r.round}/${MAX_GOAL_ROUNDS}${r.nextAt ? ` · next ${clock(r.nextAt)}` : ''}` : once(r) ? `Continue at ${clock(r.nextAt!)}` : `Loop ${r.round}${r.nextAt ? ` · next ${clock(r.nextAt)}` : ''}${r.until ? ` · until ${clock(r.until)}` : ''}`;
export const loopLabel = (loop: { phase: string | null; round: number; max: number }) => (loop.phase ? `${PHASES[loop.phase] ?? loop.phase}${['plan', 'build', 'test'].includes(loop.phase) && loop.max > 1 ? ` · round ${loop.round}/${loop.max}` : ''}` : '');
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
