import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStageOf, buildSummary, criteriaOf, findingsOf, verdictOf, type BuildEntry } from './builds.js';

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'builds.json'), 'utf8'));

type Named<T> = { name: string } & T;

describe('builds fixture', () => {
  for (const c of fixture.stageOf as Named<{ subagentType: string; description: string; prompt: string; expected: unknown }>[]) {
    it(`buildStageOf: ${c.name}`, () => expect(buildStageOf(c.subagentType, c.description, c.prompt)).toEqual(c.expected));
  }
  for (const c of fixture.verdict as Named<{ report: string; expected: unknown }>[]) it(`verdictOf: ${c.name}`, () => expect(verdictOf(c.report)).toEqual(c.expected));
  for (const c of fixture.criteria as Named<{ report: string; expected: unknown }>[]) it(`criteriaOf: ${c.name}`, () => expect(criteriaOf(c.report)).toEqual(c.expected));
  for (const c of fixture.findings as Named<{ report: string; expected: unknown }>[]) it(`findingsOf: ${c.name}`, () => expect(findingsOf(c.report)).toEqual(c.expected));
  for (const c of fixture.summary as Named<{ merged: boolean; entries: (Partial<BuildEntry> & { commit?: boolean })[]; expected: unknown }>[]) {
    it(`buildSummary: ${c.name}`, () => {
      const entries = c.entries.map((e, i) => ({ id: `e${i}`, round: 1, startedAt: i, endedAt: i, chat: 'c1', session: null, ...e, commit: e.commit ? { sha: 'abc1234def', subject: 's', date: 1, branch: null, files: [] } : undefined }) as BuildEntry);
      expect(buildSummary(entries, c.merged)).toEqual(c.expected);
    });
  }
});
