import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { approvalGate, canBuild, canSketch, buildStageOf, buildSummary, criteriaOf, findingsOf, flowOf, pipelineOf, specCriteria, verdictOf, withoutCriteria, type BuildDetail, type BuildEntry, type BuildPhase, type BuildReview } from './builds.js';

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'builds.json'), 'utf8'));

const specCases = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'spec-criteria.json'), 'utf8')) as Named<{ markdown: string; criteria: unknown; without: string }>[];

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
  for (const c of fixture.flow as Named<{ merged: boolean | string; phases: string[]; reviews: BuildReview[]; entries: (Partial<BuildEntry> & { commit?: boolean })[]; states: string[]; results?: Record<string, string> }>[]) {
    it(`flowOf: ${c.name}`, () => {
      const flow = flowOf(entriesOf(c.entries), c.reviews, c.phases.map((key) => ({ key, markdown: 'x' })) as BuildPhase[], c.merged);
      expect(flow.map((f) => f.state)).toEqual(c.states);
      for (const [key, result] of Object.entries(c.results ?? {})) expect(flow.find((f) => f.key === key)?.result).toBe(result);
    });
  }
});

describe('spec criteria fixture', () => {
  for (const c of specCases) {
    it(`specCriteria and withoutCriteria: ${c.name}`, () => {
      expect(specCriteria(c.markdown)).toEqual(c.criteria);
      expect(withoutCriteria(c.markdown)).toBe(c.without);
    });
  }
});

describe('approvalGate and the approval step', () => {
  const phases = (['requirements', 'design', 'tasks'] as const).map((key) => ({ key, markdown: 'x' })) as BuildPhase[];
  const review = (phase: BuildReview['phase'], decision: BuildReview['decision'], at: number, note = ''): BuildReview => ({ phase, decision, note, at });
  const approveAll = phases.map((p, i) => review(p.key, 'approve', i + 1));
  const pm = (startedAt: number, status: BuildEntry['status'] = 'done') => ({ stage: 'pm', status, startedAt });
  const gate = (e: Parameters<typeof entriesOf>[0], r: BuildReview[], p = phases) => approvalGate(entriesOf(e), r, p);
  const approval = (e: Parameters<typeof entriesOf>[0], r: BuildReview[]) => flowOf(entriesOf(e), r, phases, false).find((f) => f.key === 'approval')!;
  const reviewed = [pm(1), { stage: 'review', status: 'done', startedAt: 2 }] as const;

  it('approves when every phase is approved or there are no phases', () => {
    expect(gate([], approveAll).decision).toBe('approve');
    expect(gate([], [], []).decision).toBe('approve');
  });
  it('waits while a phase is undecided', () => expect(gate([], approveAll.slice(1)).decision).toBe('wait'));
  it('sends changes newer than the latest pm start to the pm with the phase title', () => {
    const r = [...approveAll.slice(1), review('requirements', 'changes', 10, 'too big')];
    expect(gate([pm(5)], r)).toEqual({ decision: 'changes', note: 'Requirements: too big' });
    expect(gate([pm(20)], r).decision).toBe('wait');
    expect(gate([], r).decision).toBe('changes');
  });
  it('sends sketch changes to the designer until a newer sketch run starts, and waits while it runs', () => {
    const withSketch = [...phases, { key: 'sketch', markdown: '<p>' }] as BuildPhase[];
    const r = [...approveAll, review('sketch', 'changes', 10, 'button up')];
    expect(gate([pm(1)], approveAll, withSketch).decision).toBe('wait');
    expect(gate([pm(1)], r, withSketch)).toEqual({ decision: 'changes', note: 'Sketch: button up' });
    expect(gate([pm(1), { stage: 'sketch', status: 'running', startedAt: 11 }], r, withSketch).decision).toBe('wait');
    expect(gate([pm(1), { stage: 'sketch', status: 'done', startedAt: 11 }], r, withSketch).decision).toBe('wait');
    expect(gate([pm(20)], r, withSketch).decision).toBe('changes');
    expect(gate([], [...approveAll, review('sketch', 'approve', 12)], withSketch).decision).toBe('approve');
  });
  it('waits while the pm runs', () => expect(gate([pm(5, 'running')], [review('design', 'changes', 10, 'x')]).decision).toBe('wait'));
  it('waits while held and approves after the release', () => {
    expect(gate([], [...approveAll, review('hold', 'hold', 9)]).decision).toBe('wait');
    expect(gate([], [...approveAll, review('hold', 'hold', 9), review('hold', 'release', 10)]).decision).toBe('approve');
  });
  it('shows Waiting for you for a reviewed, unapproved, unbuilt spec', () => {
    expect(approval([...reviewed], [])).toMatchObject({ state: 'waiting', result: 'Waiting for you' });
    expect(approval([pm(1)], [])).toMatchObject({ state: 'todo', result: '0 of 3 phases approved' });
    expect(approval([...reviewed, pm(3)], [review('design', 'changes', 2, 'x')])).toMatchObject({ result: 'Waiting for you' });
    expect(approval([...reviewed], [review('design', 'changes', 2, 'x')])).toMatchObject({ result: 'Changes requested' });
  });
});

describe('card actions', () => {
  const detail = (specFile: string | null, flow: string[], stages: string[]) => ({ specFile, flow: flow.map((key) => ({ key })), entries: stages.map((stage) => ({ stage })) }) as unknown as BuildDetail;
  it('offers Sketch only while the flow has no sketch step', () => {
    expect(canSketch(detail('s.md', ['spec'], []))).toBe(true);
    expect(canSketch(detail('s.md', ['spec', 'sketch'], []))).toBe(false);
  });
  it('offers Build for a spec file no implementer has run on', () => {
    expect(canBuild(detail('s.md', [], ['pm']))).toBe(true);
    expect(canBuild(detail('s.md', [], ['pm', 'implement']))).toBe(false);
    expect(canBuild(detail(null, [], []))).toBe(false);
  });
});
