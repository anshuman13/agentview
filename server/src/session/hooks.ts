import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AgentSession } from './session.js';

export type Hook = { name: string; on: 'save' | 'stop' | 'manual'; glob?: string; prompt: string };

const FILE = path.join(os.homedir(), '.agentview/hooks.json');
const DEBOUNCE_MS = 30_000;
const PREFIX = 'Hook: ';

const TOKENS: Record<string, string> = { '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' };

export function globMatch(glob: string, rel: string) {
  const source = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => TOKENS[m]);
  return new RegExp(`^${source}$`).test(rel);
}

export function parseHooks(raw: unknown, repo: string, bad: (line: string) => void = console.error): Hook[] {
  const list = (raw as Record<string, unknown> | null)?.[repo];
  if (!Array.isArray(list)) return [];
  return list.flatMap((h: Partial<Hook> | null, i) => {
    const ok = typeof h?.name === 'string' && h.name && typeof h.prompt === 'string' && h.prompt && (h.on === 'save' || h.on === 'stop' || h.on === 'manual') && (h.glob === undefined || typeof h.glob === 'string');
    if (!ok) bad(`hooks.json: skipped invalid hook ${i} for ${repo}`);
    return ok ? [{ name: h.name!, on: h.on!, prompt: h.prompt!, ...(h.glob !== undefined && { glob: h.glob }) }] : [];
  });
}

const promptOf = (hooks: Hook[], extra = '') => `${PREFIX}${hooks.map((h) => h.name).join(', ')}\n\n${hooks.map((h) => h.prompt + extra).join('\n\n')}`;

// Prompt hooks from ~/.agentview/hooks.json, keyed by repo name. Without the file or an entry for the repo nothing fires.
export class Hooks {
  private list: Hook[] = [];
  private fired = new Map<string, number>();
  private edited = false;

  constructor(private s: AgentSession, private file = FILE) {}

  async load() {
    const raw = await readFile(this.file, 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
    this.list = parseHooks(raw, path.basename(this.s.cwd));
    this.s.setSession({ hooks: this.list.filter((h) => h.on === 'manual').map((h) => h.name) });
  }

  private waiting() {
    return this.s.state.pending.length > 0;
  }

  noteEdit() {
    if (this.s.state.session.running) this.edited = true;
  }

  // A change while Claude runs is most likely its own, so only changes between turns count.
  saved(rel: string, now = Date.now()) {
    if (this.s.state.session.running || this.waiting()) return;
    const due = this.list.filter((h) => h.on === 'save' && (!h.glob || globMatch(h.glob, rel)) && now - (this.fired.get(h.name) ?? -Infinity) >= DEBOUNCE_MS);
    for (const h of due) {
      this.fired.set(h.name, now);
      this.s.prompts.orQueue(promptOf([h], `\n\nChanged file: ${rel}`));
    }
  }

  // The prompt for the stop hooks when the turn changed files, never after a turn a hook started.
  afterTurn() {
    const edited = this.edited;
    this.edited = false;
    const hooks = this.list.filter((h) => h.on === 'stop');
    const last = this.s.state.events.filter((e) => e.kind === 'user').at(-1);
    const chained = last?.kind === 'user' && last.text.startsWith(PREFIX);
    return edited && hooks.length > 0 && !chained && !this.waiting() ? promptOf(hooks) : null;
  }

  run(name: string) {
    const hook = this.list.find((h) => h.on === 'manual' && h.name === name);
    if (!hook) return;
    if (this.waiting()) return this.s.system('Answer the pending question first, then run the hook');
    this.s.prompts.orQueue(promptOf([hook]));
  }
}
