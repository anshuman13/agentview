import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editCount, stripRound } from '../../shared/edits';
import { todoCount, todoCurrent, todoProgress, type TodoItem } from '../../shared/todos';
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
});
