import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { appendSession, parseLog, removeSession, type Session } from './timeLog';

const a = { id: 'a', at: 1000, min: 25 };
const b = { id: 'b', at: 2000, min: 10 };

type LogCase = { name: string; log: string | null; sessions: Session[]; spent?: number; remove?: string; expected?: { time_log: string | null; spent: number | null } };
const cases = JSON.parse(readFileSync(new URL('../../../../../shared/fixtures/time-log.json', import.meta.url), 'utf8')) as LogCase[];

describe('time log', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(parseLog(c.log)).toEqual(c.sessions);
      if (c.remove != null) expect(removeSession(c.log, c.spent, c.remove)).toEqual(c.expected!);
    });
  }

  it('appends to an empty or existing log', () => {
    expect(parseLog(appendSession(null, a))).toEqual([a]);
    expect(parseLog(appendSession(JSON.stringify([a]), b))).toEqual([a, b]);
    expect(parseLog(appendSession('oops', b))).toEqual([b]);
  });
});
