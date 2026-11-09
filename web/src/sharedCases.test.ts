process.env.TZ = 'UTC';

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editCount, stripRound } from '../../shared/edits';
import type { ChatEvent, ChatRun, LiveChat, Try } from '../../shared/protocol';
import { latestTodos, todoCount, todoCurrent, todoProgress, type TodoItem } from '../../shared/todos';
import { handoffText, runLine } from './chat/composerLogic';
import { runBands } from './sessions/runBands';
import { tryColumn } from './sessions/TriesBoard';
import { parseWhen, stripWhen } from './codex/data/when';
import { needsYou } from './codex/summary/needsYou';
import { ago } from './ui/util';
import { guessProfile } from './codex/data/ask';
import type { Profile } from './codex/data/sync';
import type { Meeting } from './codex/data/wiki';

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

  for (const c of cases<{ name: string; text: string; expected: { title: string; url: string | null; why: string }[] }>('brief-bullets')) {
    it(`needsYou: ${c.name}`, () => expect(needsYou(c.text)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; text: string; now: string; expected: { at: string | null; spans: [number, number][]; stripped: string } | null }>('parse-when')) {
    it(`parseWhen: ${c.name}`, () => {
      const w = parseWhen(c.text, new Date(c.now));
      expect(w && { at: w.at === null ? null : new Date(w.at).toISOString().replace('.000Z', 'Z'), spans: w.spans, stripped: stripWhen(c.text, w) }).toEqual(c.expected);
    });
  }
});
