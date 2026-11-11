import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { buildStageOf, buildSummary, criteriaOf, findingsOf, pipelineOf, verdictOf, type BuildEntry, type BuildReview } from './builds.js';

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'builds.json'), 'utf8'));

type Named<T> = { name: string } & T;

const entriesOf = (list: (Partial<BuildEntry> & { commit?: boolean })[]) => list.map((e, i) => ({ id: `e${i}`, round: 1, startedAt: i, endedAt: i, chat: 'c1', session: null, ...e, commit: e.commit ? { sha: 'abc1234def', subject: 's', date: 1, branch: null, files: [] } : undefined }) as BuildEntry);

describe('builds fixture', () => {
  for (const c of fixture.stageOf as Named<{ subagentType: string; description: string; prompt: string; expected: unknown }>[]) {
    it(`buildStageOf: ${c.name}`, () => expect(buildStageOf(c.subagentType, c.description, c.prompt)).toEqual(c.expected));
  }
  for (const c of fixture.verdict as Named<{ report: string; expected: unknown }>[]) it(`verdictOf: ${c.name}`, () => expect(verdictOf(c.report)).toEqual(c.expected));
  for (const c of fixture.criteria as Named<{ report: string; expected: unknown }>[]) it(`criteriaOf: ${c.name}`, () => expect(criteriaOf(c.report)).toEqual(c.expected));
  for (const c of fixture.findings as Named<{ report: string; expected: unknown }>[]) it(`findingsOf: ${c.name}`, () => expect(findingsOf(c.report)).toEqual(c.expected));
  for (const c of fixture.summary as Named<{ merged: boolean; entries: (Partial<BuildEntry> & { commit?: boolean })[]; expected: unknown }>[]) {
    it(`buildSummary: ${c.name}`, () => {
      expect(buildSummary(entriesOf(c.entries), c.merged)).toEqual(c.expected);
    });
  }
  for (const c of fixture.pipeline as Named<{ merged: boolean; reviews: BuildReview[]; entries: (Partial<BuildEntry> & { commit?: boolean })[]; expected: unknown }>[]) {
    it(`pipelineOf: ${c.name}`, () => expect(pipelineOf(entriesOf(c.entries), c.merged, c.reviews)).toEqual(c.expected));
  }
});
