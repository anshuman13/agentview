process.env.TZ = 'UTC';

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { barHidden, barIdle, barState, type BarEvent } from '../../shared/bottomBar';
import { appCounts } from '../../shared/counts';
import { editCount, stripRound } from '../../shared/edits';
import { FEATURES, featureRows, paletteFeature, type UseDays } from '../../shared/featureUse';
import type { Capabilities, ChatEvent, ChatRun, LiveChat, Provider, Try } from '../../shared/protocol';
import { billing, providerLabel, providerMark, providerModes, type Billing } from '../../shared/providers';
import { setupPrompt, type SetupKind } from '../../shared/setupPrompt';
import { appendRule } from '../../shared/steering';
import { goalCommand, planOf, type GoalForm } from '../../shared/goalForm';
import { isSpecPath, planCondition, runAllPrompt, specProgress, specPrompt, specSlug, specTasks, startTaskPrompt, withoutOpenTasks, type SpecTask } from '../../shared/specTasks';
import { isSketchPath, sketchDoc, type SketchTheme } from '../../shared/sketches';
import { latestTodos, todoCount, todoCurrent, todoProgress, type TodoItem } from '../../shared/todos';
import { countChat } from './app/store/counts';
import { can, modelsFor } from './chat/capabilitiesLogic';
import { chatState, handoffText, runLine } from './chat/composer/composerLogic';
import { runBands } from './sessions/runBands';
import { tryColumn } from './sessions/TriesBoard';
import { parseWhen, stripWhen } from './codex/data/tasks/when';
import { needsYou } from './codex/summary/needsYou';
import { reviewQueue } from './codex/wiki/reviewQueue';
import { revertBlock } from './workspace/revertBlock';
import { ago, money } from './ui/util';
import { turnEvents, turnSummary, type SummaryEntry } from './chat/transcript/summary';
import { guessProfile } from './codex/data/ask/ask';
import type { Profile } from './codex/data/sync';
import type { Meeting } from './codex/data/wiki/wiki';

const cases = <T>(file: string): T[] => JSON.parse(readFileSync(new URL(`../../shared/fixtures/${file}.json`, import.meta.url), 'utf8'));

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

describe('cases shared with the Android app', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  type Guess = { name: string; question: string; fallback: Profile; expected: Profile; meetings: { title: string; profile: Profile; startsInHours: number; deleted?: boolean }[] };
  for (const c of cases<Guess>('guess-profile')) {
    it(`guessProfile: ${c.name}`, () => {
      const meetings = c.meetings.map((m, i) => ({ id: `m${i}`, profile: m.profile, deleted: m.deleted ? 1 : 0, state: 'live', title: m.title, starts_at: NOW + m.startsInHours * HOUR, others: null, links: null }) as unknown as Meeting);
      expect(guessProfile(c.question, meetings, c.fallback, NOW)).toBe(c.expected);
    });
  }

  for (const c of cases<{ name: string; tool: string; input: Record<string, unknown>; expected: { add: number; del: number } | null }>('edit-count')) {
    it(`editCount: ${c.name}`, () => expect(editCount(c.tool, c.input)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; text: string; expected: string }>('strip-round')) {
    it(`stripRound: ${c.name}`, () => expect(stripRound(c.text)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; ageMs: number; suffix: string; expected: string }>('ago')) {
    it(`ago: ${c.name}`, () => expect(ago(NOW - c.ageMs, c.suffix)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; items: TodoItem[]; progress: string; current: string }>('checklist')) {
    it(`todos: ${c.name}`, () => {
      expect(todoProgress(todoCount(c.items))).toBe(c.progress);
      expect(todoCurrent(c.items)).toBe(c.current);
    });
  }

  for (const c of cases<{ name: string; path: string; isSpec: boolean; md: string; tasks: SpecTask[]; progress: string; start: string | null; all: string }>('spec-tasks')) {
    it(`specTasks: ${c.name}`, () => {
      const tasks = specTasks(c.md);
      const open = tasks.find((t) => !t.done);
      expect(tasks).toEqual(c.tasks);
      expect(isSpecPath(c.path)).toBe(c.isSpec);
      expect(specProgress(tasks)).toBe(c.progress);
      expect(open && startTaskPrompt(open, c.path)).toBe(c.start ?? undefined);
      expect(runAllPrompt(c.path)).toBe(c.all);
    });
  }

  for (const c of cases<{ name: string; md: string; expected: string }>('spec-open-tasks')) {
    it(`withoutOpenTasks: ${c.name}`, () => expect(withoutOpenTasks(c.md)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; path: string; slug: string }>('spec-slug')) {
    it(`specSlug: ${c.name}`, () => expect(specSlug(c.path)).toBe(c.slug));
  }

  for (const c of cases<{ name: string; html: string; theme: SketchTheme; doc: string }>('sketch-doc')) {
    it(`sketchDoc: ${c.name}`, () => {
      expect(sketchDoc(c.html, c.theme)).toBe(c.doc);
      expect(c.doc).toContain(`data-theme="${c.theme}"`);
      expect(c.doc.replace(/^<!doctype html>\s*/i, '').replace(/^<html[^>]*>(<head[^>]*>)?/i, '')).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
    });
  }

  for (const c of cases<{ name: string; path: string; sketch: boolean }>('sketch-path')) {
    it(`isSketchPath: ${c.name}`, () => expect(isSketchPath(c.path)).toBe(c.sketch));
  }

  for (const c of cases<{ name: string; form?: GoalForm; now?: number; command?: string; what?: string; plan?: string | null; path?: string; md?: string; condition?: string }>('goal-command')) {
    it(`goalForm: ${c.name}`, () => {
      if (c.form) expect(goalCommand(c.form, c.now!)).toBe(c.command);
      else if (c.condition) expect(planCondition(c.path!, c.md!)).toBe(c.condition);
      else expect(planOf(c.what!)).toBe(c.plan);
    });
  }

  for (const c of cases<{ name: string; text: string; rule: string; expected: string | null }>('append-rule')) {
    it(`appendRule: ${c.name}`, () => expect(appendRule(c.text, c.rule)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; request: string; expected: string }>('spec-prompt')) {
    it(`specPrompt: ${c.name}`, () => expect(specPrompt(c.request)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; kind: SetupKind; repo: string; mcpCommand: string; expected: string }>('setup-prompts')) {
    it(`setupPrompt: ${c.name}`, () => expect(setupPrompt(c.kind, c.repo, c.mcpCommand)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; sessionId: string; expected: string }>('handoff-text')) {
    it(`handoffText: ${c.name}`, () => expect(handoffText(c.sessionId)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; events: unknown[]; expected: TodoItem[] | null }>('checklist-events')) {
    it(`latestTodos: ${c.name}`, () => expect(latestTodos(c.events as ChatEvent[])).toEqual(c.expected));
  }

  const run = (over: Partial<ChatRun>): ChatRun => ({ id: 'r', kind: 'loop', sessionId: 's', chatId: 'c', title: '', what: '', startedAt: 1, endedAt: null, state: 'running', why: '', round: 0, max: 0, nextAt: null, costUsd: 0, rounds: [], needsYou: false, ...over });

  for (const c of cases<{ name: string; run: Omit<Partial<ChatRun>, 'tries'> & { tries?: Partial<Try>[] }; phase: string | null; expected: string }>('run-line')) {
    it(`runLine: ${c.name}`, () => expect(runLine(run({ ...c.run, tries: c.run.tries?.map((t) => ({ n: 0, chatId: '', sessionId: '', branch: '', ...t })) }), c.phase)).toBe(c.expected));
  }

  type StateCase = { name: string; chat: Partial<LiveChat> & { agents?: number; run?: { state: ChatRun['state']; why?: string; nextAtLocal?: string } }; expected: unknown };
  for (const c of cases<StateCase>('chat-state')) {
    it(`chatState: ${c.name}`, () => {
      const { agents = 0, run, ...chat } = c.chat;
      const agentList = Array.from({ length: agents }, (_, i) => ({ id: `a${i}`, description: '', type: '', startedAt: 0 }));
      expect(chatState({ pending: 0, running: false, status: '', ...chat, agentList, run: run && { state: run.state, why: run.why, nextAt: run.nextAtLocal ? new Date(run.nextAtLocal).getTime() : null } })).toEqual(c.expected);
    });
  }

  type CountsCase = { name: string; viewing: string; seen?: Record<string, number>; attention?: number; chats: (Partial<LiveChat> & { run?: Partial<NonNullable<LiveChat['run']>> })[]; mcp?: { name: string; status: string }[]; hidden?: Record<string, string>; needsYouRows?: number; replyRows?: number; expected: unknown };
  for (const c of cases<CountsCase>('counts')) {
    it(`appCounts: ${c.name}`, () => {
      const chats = c.chats.map((chat) => countChat({ pending: 0, running: false, status: '', lastActive: 0, cwd: '', title: '', sessionId: null, ...chat } as LiveChat, c.seen ?? {}));
      expect(appCounts({ chats, viewing: c.viewing, attention: c.attention ?? 0, mcp: c.mcp ?? [], hidden: c.hidden ?? {}, needsYouRows: c.needsYouRows ?? 0, replyRows: c.replyRows ?? 0 })).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; runs: Partial<ChatRun>[]; expected: { needs: string[]; running: string[]; finished: string[] } }>('run-bands')) {
    it(`runBands: ${c.name}`, () => {
      const b = runBands(c.runs.map(run), []);
      expect({ needs: b.needs.map((i) => (i.kind === 'run' ? i.run.id : '')), running: b.running.map((i) => (i.kind === 'run' ? i.run.id : '')), finished: b.finished.map((r) => r.id) }).toEqual(c.expected);
    });
  }

  type TryCase = { name: string; run: { rounds: Partial<ChatRun['rounds'][number]>[] }; try: Partial<Try>; live: Partial<LiveChat>[]; expected: { n: number; branch: string; state: string; line: string; edits: { add: number; del: number } | null; cost: number; archived: boolean } };
  for (const c of cases<TryCase>('try-column')) {
    it(`tryColumn: ${c.name}`, () => {
      const col = tryColumn(run({ rounds: c.run.rounds.map((r) => ({ n: 0, at: 0, outcome: 'done', line: '', costUsd: 0, ...r })) }), { chatId: '', ...c.try } as Try, c.live as LiveChat[]);
      const state = col.state.status === 'waiting' ? col.state.label : col.state.status === 'skipped' ? col.state.reason : { running: 'Running', failed: 'Failed', done: 'Done' }[col.state.status as string];
      expect({ ...col, state, edits: col.edits ?? null }).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; original: string; content: string; block: number; expected: string }>('revert-block')) {
    it(`revertBlock: ${c.name}`, () => expect(revertBlock(c.original, c.content, c.block)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; text: string; expected: { title: string; url: string | null; why: string }[] }>('brief-bullets')) {
    it(`needsYou: ${c.name}`, () => expect(needsYou(c.text)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; text: string; now: string; expected: { at: string | null; spans: [number, number][]; stripped: string } | null }>('parse-when')) {
    it(`parseWhen: ${c.name}`, () => {
      const w = parseWhen(c.text, new Date(c.now));
      expect(w && { at: w.at === null ? null : new Date(w.at).toISOString().replace('.000Z', 'Z'), spans: w.spans, stripped: stripWhen(c.text, w) }).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; order: string[]; skipped: string[]; open: string[]; expected: string[] }>('review-queue')) {
    it(`reviewQueue: ${c.name}`, () => expect(reviewQueue(c.order, c.skipped, new Set(c.open))).toEqual(c.expected));
  }

  type Caps = { name: string; capabilities: Capabilities | null; models: string[]; shown: string[]; can: Record<keyof Capabilities, boolean> };
  for (const c of cases<Caps>('capabilities')) {
    it(`capabilities: ${c.name}`, () => {
      const caps = c.capabilities ?? undefined;
      expect(modelsFor(c.models.map((value) => ({ value })), caps).map((m) => m.value)).toEqual(c.shown);
      expect(Object.fromEntries(Object.keys(c.can).map((k) => [k, can(caps, k as keyof Capabilities)]))).toEqual(c.can);
    });
  }

  type Table = { name: string; provider: Provider | null; label: string; billing: Billing; mark: string | null; modes: string[] };
  for (const c of cases<Table>('providers')) {
    it(`provider table: ${c.name}`, () => {
      const p = c.provider ?? undefined;
      expect(providerLabel(p)).toBe(c.label);
      expect(billing(p)).toBe(c.billing);
      expect(providerMark(p) ?? null).toBe(c.mark);
      expect(providerModes(p).map((m) => m.value)).toEqual(c.modes);
    });
  }

  for (const c of cases<{ name: string; n: number; billing: Billing; expected: string }>('money')) {
    it(`money: ${c.name}`, () => expect(money(c.n, c.billing)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; events: BarEvent[]; hidden: boolean[] }>('bottom-bar')) {
    it(`barState: ${c.name}`, () => {
      let state = barIdle;
      expect(c.events.map((e) => barHidden((state = barState(state, e))))).toEqual(c.hidden);
    });
  }

  for (const c of cases<{ name: string; events: unknown[]; cuts: Record<string, string[]>; entries: Record<string, SummaryEntry[]> }>('turn-summary')) {
    it(`turnSummary: ${c.name}`, () => {
      const turns = turnEvents(c.events as ChatEvent[]);
      expect(Object.fromEntries(turns.map((t) => [t.id, t.events.map((e) => e.id)]))).toEqual(c.cuts);
      for (const [id, entries] of Object.entries(c.entries)) expect(turnSummary(turns.find((t) => t.id === id)!.events)).toEqual(entries);
    });
  }

  const featureUse = JSON.parse(readFileSync(new URL('../../shared/fixtures/feature-use.json', import.meta.url), 'utf8')) as {
    ids: string[];
    palette: { id: string; expected: string | null }[];
    rows: { name: string; today: string; window: 7 | 30; days: UseDays; never: string[]; used: [string, number, number, string][] }[];
  };
  it('feature catalogue ids', () => expect(FEATURES.map((f) => f.id)).toEqual(featureUse.ids));
  for (const c of featureUse.palette) it(`paletteFeature: ${c.id}`, () => expect(paletteFeature(c.id)).toBe(c.expected));
  for (const c of featureUse.rows) {
    it(`featureRows: ${c.name}`, () => {
      const r = featureRows(c.days, c.today, c.window);
      expect(r.never.map((f) => f.id)).toEqual(c.never);
      expect(r.used.map((u) => [u.id, u.n7, u.n30, u.last])).toEqual(c.used);
    });
  }
});
