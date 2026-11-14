import type { AgentStatus } from './protocol.js';

export type BuildStage = 'pm' | 'review' | 'sketch' | 'implement' | 'test' | 'code-review';
export type BuildState = 'running' | 'waiting' | 'failed' | 'done';
export type BuildFile = { path: string; additions: number; deletions: number };
export type BuildCommit = { sha: string; subject: string; date: number; branch: string | null; files: BuildFile[] };
export type BuildEntry = {
  id: string;
  stage: BuildStage;
  round: number;
  status: AgentStatus;
  startedAt: number;
  endedAt: number | null;
  report: string;
  chat: string;
  session: string | null;
  commit?: BuildCommit;
  tokens?: number;
};
export type BuildSummary = { stage: BuildStage; state: BuildState; conclusion: string };
export type Criterion = { n: number; result: 'pass' | 'fail' | 'unverified' | 'pending'; evidence: string };
export type SpecCriterion = Criterion & { text: string; ui: boolean };
export type BuildPipeline = 'written' | 'reviewed' | 'implemented' | 'tested' | 'code-reviewed' | 'merged';
export type SpecPhase = 'requirements' | 'design' | 'tasks';
// `sketch` is a phase only while the build has a sketch file; its markdown is the sketch's HTML, approved like the spec phases.
export type ReviewPhase = SpecPhase | 'sketch';
export type ReviewTarget = ReviewPhase | 'code' | 'hold';
export type BuildReview = { phase: ReviewTarget; decision: 'approve' | 'changes' | 'hold' | 'release'; note: string; at: number };
export type BuildPhase = { key: ReviewPhase; markdown: string };
export type FlowStep = { key: 'spec' | 'spec-review' | 'sketch' | 'approval' | 'implement' | 'test' | 'code-review' | 'merge'; state: BuildState | 'skipped' | 'todo'; by: string; result: string; at: number | null };
export type BuildDetail = {
  slug: string;
  title: string;
  summary: BuildSummary;
  pipeline: BuildPipeline;
  updatedAt: number;
  specFile: string | null;
  phases: BuildPhase[];
  reviews: BuildReview[];
  hold: boolean;
  codeReview: BuildReview | null;
  criteria: SpecCriterion[];
  flow: FlowStep[];
  entries: (BuildEntry & { verdict: string | null; criteria: Criterion[]; findings: string[] })[];
  commit: { files: { path: string; add: number; del: number }[]; diff: string } | null;
};

const HAND: Record<string, BuildStage> = { pm: 'pm', 'spec-reviewer': 'review', implementer: 'implement', tester: 'test', 'code-reviewer': 'code-review' };
const LABEL: Record<string, BuildStage> = { pm: 'pm', review: 'review', sketch: 'sketch', impl: 'implement', test: 'test', 'code-review': 'code-review' };
const STAGE_NAME: Record<BuildStage, string> = { pm: 'Spec', review: 'Spec review', sketch: 'Sketch', implement: 'Implement', test: 'Test', 'code-review': 'Code review' };

// Whether a spec card offers Sketch (no sketch yet) and Build (a spec file, no implementer run yet).
export const canSketch = (d: BuildDetail) => !d.flow.some((f) => f.key === 'sketch');
export const canBuild = (d: BuildDetail) => d.specFile !== null && !d.entries.some((e) => e.stage === 'implement');

export const stageName = (stage: BuildStage) => STAGE_NAME[stage];

const PIPELINE_LABEL: Record<BuildPipeline, string> = { written: 'Spec written', reviewed: 'Spec reviewed', implemented: 'Implemented', tested: 'Tested', 'code-reviewed': 'Code reviewed', merged: 'Merged' };

export const pipelineLabel = (pipeline: BuildPipeline) => PIPELINE_LABEL[pipeline];

export type SpecHomeItem = { slug: string; title: string; pipeline: BuildPipeline; state: BuildState; conclusion: string; updatedAt: number; hold: boolean; waiting: boolean; chat: string | null; session: string | null; built: boolean; sketched: boolean };

const specHomeGroup = (i: SpecHomeItem) =>
  i.waiting || i.hold ? 0 : ['running', 'failed', 'waiting'].includes(i.state) ? 1 : i.pipeline === 'merged' ? 4 : i.built ? 2 : 3;

// The spec home list: what needs you first, then what runs, what is built but not merged, what is not built, what is merged; newest first within each.
// A Specs row's meta and age: the stage and conclusion, a merged spec saying "Merged" once, and the age of the last change when known.
export function specRowParts({ pipeline, conclusion, updatedAt }: Pick<SpecHomeItem, 'pipeline' | 'conclusion' | 'updatedAt'>, ago: (t: number) => string) {
  const label = pipeline === 'merged' && conclusion.startsWith('Merged') ? '' : pipelineLabel(pipeline);
  return { meta: [label, conclusion].filter(Boolean).join(' · '), when: updatedAt > 0 ? ago(updatedAt) : '' };
}

export const specHomeOrder = (items: SpecHomeItem[]) => [...items].sort((a, b) => specHomeGroup(a) - specHomeGroup(b) || b.updatedAt - a.updatedAt);

export const phaseLabel = (key: ReviewTarget) => key[0].toUpperCase() + key.slice(1);

export const decisionTitle = (r: BuildReview | undefined) => (!r ? 'Not reviewed' : r.decision === 'approve' ? 'Approved' : 'Changes requested');

// The line a decision adds to a spec's Review notes.
export const reviewLine = (r: BuildReview) =>
  r.phase === 'hold' ? (r.decision === 'hold' ? 'Hold: do not start or continue this spec' : 'Hold released') : `${phaseLabel(r.phase)}: ${decisionTitle(r)}${r.note && `: ${r.note}`}`;

export const REVIEW_PHASES: SpecPhase[] = ['requirements', 'design', 'tasks'];

export const isReviewPhase = (v: unknown): v is ReviewPhase => v === 'sketch' || REVIEW_PHASES.includes(v as SpecPhase);

export const reviewDecision = (reviews: BuildReview[], phase: ReviewTarget) => reviews.filter((r) => r.phase === phase).at(-1);

export const isHeld = (reviews: BuildReview[]) => reviewDecision(reviews, 'hold')?.decision === 'hold';

export const latestRun = <E extends BuildEntry>(entries: E[], stage: BuildStage) => inOrder(entries).filter((e) => e.stage === stage).at(-1);

// A decision counts for the version it was made on: one older than the latest start of the agent that rewrites the phase (the designer for the sketch, the pm for the spec) is stale.
const current = (entries: BuildEntry[], r: BuildReview | undefined) => {
  const run = r && latestRun(entries, r.phase === 'sketch' ? 'sketch' : 'pm');
  return Boolean(r) && (!run || r!.at > run.startedAt);
};

const phaseDecision = (entries: BuildEntry[], reviews: BuildReview[], p: BuildPhase) => {
  const r = reviewDecision(reviews, p.key);
  return current(entries, r) ? r!.decision : undefined;
};

// Latest changes requests the agent that answers them has not started on yet.
const unhandledChanges = (entries: BuildEntry[], reviews: BuildReview[], phases: BuildPhase[]) =>
  phases.map((p) => reviewDecision(reviews, p.key)).filter((r): r is BuildReview => r?.decision === 'changes' && current(entries, r));

export type ApprovalGate = { decision: 'approve' | 'changes' | 'wait'; note: string };

// What a build waits for before implementing: the user's approval of every phase, or changes for the pm.
export function approvalGate(entries: BuildEntry[], reviews: BuildReview[], phases: BuildPhase[]): ApprovalGate {
  const running = (stage: BuildStage) => latestRun(entries, stage)?.status === 'running';
  if (isHeld(reviews) || running('pm') || running('sketch')) return { decision: 'wait', note: '' };
  const changes = unhandledChanges(entries, reviews, phases);
  if (changes.length) return { decision: 'changes', note: changes.map((r) => `${phaseLabel(r.phase)}: ${r.note}`).join('\n') };
  return { decision: phases.every((p) => phaseDecision(entries, reviews, p) === 'approve') ? 'approve' : 'wait', note: '' };
}

export const slugOk = (slug: string | undefined): slug is string => Boolean(slug) && !slug!.includes('..');

// The stage and slug a build agent works on: a /build label like `impl:<slug>#2`, else a hand run named by its spec path. `round` is the label's numeric #N.
export function buildStageOf(subagentType: string, description: string, prompt: string): { stage: BuildStage; slug: string; round: number | null } | null {
  const label = /^(pm|review|sketch|impl|test|code-review):([\w.-]+)(?:#(\w+))?$/.exec(description.trim());
  if (label && slugOk(label[2])) return { stage: LABEL[label[1]], slug: label[2], round: label[3] && /^\d+$/.test(label[3]) ? Number(label[3]) : null };
  const stage = HAND[subagentType?.replace(/^agentview:/, '')];
  const slug = /\.claude\/specs\/([\w.-]+?)\.md/.exec(prompt)?.[1];
  return stage && slugOk(slug) ? { stage, slug, round: null } : null;
}

// The slug of the approval gate agent, labelled `gate:<slug>`; it is not a build stage.
export const gateSlugOf = (description: string) => {
  const slug = /^gate:([\w.-]+)$/.exec(description.trim())?.[1];
  return slugOk(slug) ? slug : null;
};

const jsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export function verdictOf(report: string) {
  const v = jsonObject(report)?.verdict;
  if (typeof v === 'string') return v.toLowerCase();
  return /\b(approve|revise|pass|fail|clean|changes)\b/i.exec(report)?.[1].toLowerCase() ?? null;
}

// The text above the first level-2 heading, then one section per `## ` heading (lowercased), fenced code skipped. `prose` is the lines outside fenced code.
export function sectionsOf(markdown: string) {
  const sections: { heading: string | null; lines: string[]; prose: string[] }[] = [{ heading: null, lines: [], prose: [] }];
  let fence = '';
  for (const line of markdown.split('\n')) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) fence = !fence ? mark : mark[0] === fence[0] && mark.length >= fence.length ? '' : fence;
    const heading = !fence && !mark ? /^## +(.+?)\s*$/.exec(line)?.[1] : undefined;
    if (heading) sections.push({ heading: heading.toLowerCase(), lines: [], prose: [] });
    sections.at(-1)!.lines.push(line);
    if (!fence && !mark) sections.at(-1)!.prose.push(line);
  }
  return sections;
}

const CRITERIA = 'acceptance criteria';
const ITEM = /^(\d+)[.)]\s+/;

export function specCriteria(markdown: string): { n: number; text: string; ui: boolean }[] {
  const items: { n: number; text: string }[] = [];
  let open = false;
  for (const line of sectionsOf(markdown).find((s) => s.heading === CRITERIA)?.prose ?? []) {
    const m = ITEM.exec(line);
    const more = /^\s/.test(line) && line.trim() !== '';
    if (m) items.push({ n: Number(m[1]), text: line.slice(m[0].length).trim() });
    else if (open && more) items.at(-1)!.text += ` ${line.trim()}`;
    open = Boolean(m) || (open && more);
  }
  return items.map(({ n, text }) => ({
    n,
    text: text.replaceAll('(UI)', '').replace(/\s*\(\d+(,\s*\d+)*\)\s*$/, '').replace(/\s+/g, ' ').trim(),
    ui: text.includes('(UI)'),
  }));
}

export const withoutCriteria = (markdown: string) => sectionsOf(markdown).filter((s) => s.heading !== CRITERIA).flatMap((s) => s.lines).join('\n').trim();

export function criteriaOf(report: string): Criterion[] {
  const inner = jsonObject(report)?.report;
  const text = typeof inner === 'string' ? inner : report;
  return text.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\.\s+(pass|fail|unverified):\s*(.*)$/i.exec(line);
    return m ? [{ n: Number(m[1]), result: m[2].toLowerCase() as Criterion['result'], evidence: m[3].trim() }] : [];
  });
}

export function findingsOf(report: string): string[] {
  const issues = jsonObject(report)?.issues;
  if (Array.isArray(issues)) return issues.filter((i): i is string => typeof i === 'string');
  return report.split('\n').flatMap((line) => {
    const m = /^\s*(?:-|\d+[.)])\s+(.+)$/.exec(line);
    return m ? [m[1].trim()] : [];
  });
}

export const inOrder = <E extends BuildEntry>(entries: E[]): E[] => entries.map((e, i) => [e, i] as const).sort((a, b) => a[0].startedAt - b[0].startedAt || a[1] - b[1]).map(([e]) => e);

export function buildTotals(entries: BuildEntry[], now: number) {
  let ms = 0;
  let end = 0;
  for (const e of [...entries].sort((a, b) => a.startedAt - b.startedAt)) {
    const to = e.status === 'running' ? now : e.endedAt ?? e.startedAt;
    ms += Math.max(0, to - Math.max(e.startedAt, end));
    end = Math.max(end, to);
  }
  return {
    runs: entries.length,
    ms,
    tokens: entries.reduce((n, e) => n + (e.tokens ?? 0), 0),
    partial: entries.some((e) => e.status !== 'running' && e.tokens === undefined),
  };
}

export const lastCommit = (entries: BuildEntry[]) => inOrder(entries).filter((e) => e.stage === 'implement').at(-1)?.commit;

// The furthest step the build reached. `merged`: the latest implement commit reached the default branch.
// True or the sha the default branch holds the build under (a cherry-pick gets a new sha); false when not merged.
export type Merged = boolean | string;
const mergedSha = (merged: Merged, commit: BuildCommit | undefined) => (typeof merged === 'string' ? merged : commit?.sha ?? '').slice(0, 7);

export function pipelineOf(entries: BuildEntry[], merged: Merged, reviews: BuildReview[]): BuildPipeline {
  const all = inOrder(entries);
  const latest = (stage: BuildStage) => all.filter((e) => e.stage === stage).at(-1);
  const code = latest('code-review');
  const test = latest('test');
  if (merged) return 'merged';
  if (code?.status === 'done' && ['clean', 'approve'].includes(verdictOf(code.report) ?? '')) return 'code-reviewed';
  if (test?.status === 'done' && verdictOf(test.report) === 'pass') return 'tested';
  if (all.some((e) => e.stage === 'implement' && e.commit)) return 'implemented';
  if (all.some((e) => e.stage === 'review' && verdictOf(e.report) === 'approve') || reviewDecision(reviews, 'requirements')?.decision === 'approve') return 'reviewed';
  return 'written';
}

// `merged`: the latest implement commit reached the default branch.
export function buildSummary(entries: BuildEntry[], merged: Merged): BuildSummary {
  const all = inOrder(entries);
  const tail = all.at(-1);
  if (!tail) return { stage: 'pm', state: 'done', conclusion: '' };
  const latest = (stage: BuildStage) => all.filter((e) => e.stage === stage).at(-1);
  const after = (e: BuildEntry, stage: BuildStage) => all.some((x, i) => x.stage === stage && i > all.indexOf(e));
  const running = all.filter((e) => e.status === 'running').at(-1);
  if (running) return { stage: running.stage, state: 'running', conclusion: `${STAGE_NAME[running.stage]} running` };
  const review = latest('review');
  if (review && verdictOf(review.report) === 'revise' && !after(review, 'pm')) return { stage: 'review', state: 'waiting', conclusion: 'Spec needs revision' };
  const test = latest('test');
  if (test && (test.status === 'failed' || verdictOf(test.report) === 'fail')) {
    const criteria = criteriaOf(test.report);
    const failed = criteria.filter((c) => c.result === 'fail').length;
    return { stage: 'test', state: 'failed', conclusion: criteria.length ? `Tests failed · ${failed} of ${criteria.length} criteria` : 'Tests failed' };
  }
  const code = latest('code-review');
  if (code && verdictOf(code.report) === 'changes' && !after(code, 'implement')) {
    const n = findingsOf(code.report).length;
    return { stage: 'code-review', state: 'failed', conclusion: `Code review asks for ${n} change${n === 1 ? '' : 's'}` };
  }
  const name = STAGE_NAME[tail.stage];
  if (tail.status === 'failed') return { stage: tail.stage, state: 'failed', conclusion: `${name} failed` };
  if (tail.status === 'stopped') return { stage: tail.stage, state: 'done', conclusion: `${name} stopped` };
  const impl = latest('implement');
  if (!impl) return { stage: tail.stage, state: 'done', conclusion: `${name} done` };
  const conclusion = !impl.commit ? 'No commit found' : merged ? `Merged as ${mergedSha(merged, impl.commit)}` : 'Passed · not merged yet';
  return { stage: tail.stage, state: 'done', conclusion };
}


// Where the build stands in the pipeline, one step per stage from spec to merge. `merged`: the latest implement commit reached the default branch.
export function flowOf(entries: BuildEntry[], reviews: BuildReview[], phases: BuildPhase[], merged: Merged): FlowStep[] {
  const all = inOrder(entries);
  const latest = (stage: BuildStage) => all.filter((e) => e.stage === stage).at(-1);
  const after = (e: BuildEntry, stage: BuildStage) => all.some((x, i) => x.stage === stage && i > all.indexOf(e));
  const at = (e: BuildEntry | undefined) => (e ? e.endedAt ?? e.startedAt : null);
  const verdict = (e: BuildEntry) => verdictOf(e.report) ?? '';
  const step = (key: FlowStep['key'], by: string, state: FlowStep['state'], result: string, when: number | null = null): FlowStep => ({ key, state, by, result, at: when });
  const run = (key: FlowStep['key'], by: string, e: BuildEntry) => (state: FlowStep['state'], result: string) => step(key, by, state, result, at(e));
  const none = (key: FlowStep['key'], by: string) => step(key, by, 'todo', '');

  const pms = all.filter((e) => e.stage === 'pm');
  const pm = pms.at(-1);
  const spec = pm?.status === 'running' ? step('spec', 'pm', 'running', 'Running', at(pm)) : pm?.status === 'failed' ? step('spec', 'pm', 'failed', 'Failed', at(pm)) : step('spec', pm ? 'pm' : 'You', 'done', pms.length > 1 ? `${pms.length} rounds` : 'Written', at(pm));

  const R = latest('review');
  const specReview = ((): FlowStep => {
    if (!R) return none('spec-review', 'spec-reviewer');
    const make = run('spec-review', 'spec-reviewer', R);
    if (R.status === 'running') return make('running', 'Running');
    if (R.status === 'failed' || R.status === 'stopped') return make('failed', 'Failed');
    const v = verdict(R);
    if (v === 'approve') return make('done', 'Approved');
    if (v !== 'revise') return make('done', 'Reviewed');
    if (!after(R, 'pm')) return make('waiting', `Revise · ${findingsOf(R.report).length} issues`);
    return pm?.status === 'running' ? make('running', 'Revising') : make('todo', 'Revised, not re-reviewed');
  })();

  const S = latest('sketch');
  const sketch = ((): FlowStep | null => {
    if (!S) return phases.some((p) => p.key === 'sketch') ? step('sketch', '', 'done', 'Written') : null;
    const make = run('sketch', 'designer', S);
    const rounds = all.filter((e) => e.stage === 'sketch').length;
    if (S.status === 'running') return make('running', rounds > 1 ? 'Updating' : 'Running');
    if (S.status === 'failed' || S.status === 'stopped') return all.some((e) => e.stage === 'implement') ? make('skipped', 'Failed · built without it') : make('failed', 'Failed');
    return make('done', rounds > 1 ? `${rounds} rounds` : 'Written');
  })();

  const decided = reviews.filter((r) => isReviewPhase(r.phase)).at(-1)?.at ?? null;
  const approved = phases.filter((p) => phaseDecision(all, reviews, p) === 'approve').length;
  const reviewed = all.some((e) => e.stage === 'review' && e.status === 'done') && !all.some((e) => e.stage === 'implement') && pm?.status !== 'running' && S?.status !== 'running';
  const approval =
    !phases.length ? step('approval', 'You', 'todo', '0 of 0 phases approved', decided)
    : approved === phases.length ? step('approval', 'You', 'done', 'Approved', decided)
    : unhandledChanges(all, reviews, phases).length ? step('approval', 'You', 'waiting', 'Changes requested', decided)
    : reviewed ? step('approval', 'You', 'waiting', 'Waiting for you', decided)
    : all.some((e) => e.stage === 'implement') ? step('approval', 'You', 'skipped', 'Built without approval', decided)
    : step('approval', 'You', 'todo', `${approved} of ${phases.length} phases approved`, decided);

  const I = latest('implement');
  const implement = ((): FlowStep => {
    if (!I) return none('implement', 'implementer');
    const make = run('implement', 'implementer', I);
    if (I.status === 'running') return make('running', 'Running');
    if (I.commit) return make('done', I.commit.branch ? `${I.commit.branch} · ${I.commit.sha.slice(0, 7)}` : I.commit.sha.slice(0, 7));
    return make('failed', I.status === 'failed' ? 'Failed' : 'No commit found');
  })();

  const T = latest('test');
  const test = ((): FlowStep => {
    if (!T) return none('test', 'tester');
    const make = run('test', 'tester', T);
    const lines = criteriaOf(T.report);
    const counts = `${lines.filter((c) => c.result === 'pass').length} of ${lines.length} pass`;
    if (T.status === 'running') return make('running', 'Running');
    if (T.status === 'failed' || verdict(T) === 'fail') return make('failed', lines.length ? counts : 'Failed');
    if (verdict(T) === 'pass') return make('done', lines.length ? counts : 'Passed');
    return make('todo', 'No verdict');
  })();

  const C = latest('code-review');
  const codeReview = ((): FlowStep => {
    if (!C) return none('code-review', 'code-reviewer');
    const make = run('code-review', 'code-reviewer', C);
    if (C.status === 'running') return make('running', 'Running');
    if (C.status === 'failed') return make('failed', 'Failed');
    const v = verdict(C);
    if (v === 'clean' || v === 'approve') return make('done', 'Clean');
    if (v !== 'changes') return make('todo', 'No verdict');
    const n = findingsOf(C.report).length;
    if (!after(C, 'implement')) return make('failed', `${n} findings`);
    return test.state === 'done' && after(C, 'test') ? make('done', `${n} findings fixed`) : make('todo', 'Fixed, not re-reviewed');
  })();

  const commit = lastCommit(entries);
  const merge = merged ? step('merge', '', 'done', `Merged as ${mergedSha(merged, commit)}`, commit?.date ?? null) : test.state === 'done' ? step('merge', '', 'waiting', 'Not merged yet') : none('merge', '');

  const flow = [spec, specReview, ...(sketch ? [sketch] : []), approval, implement, test, codeReview, merge];
  if (isHeld(reviews)) {
    const i = flow.findIndex((f) => ['todo', 'waiting', 'failed'].includes(f.state));
    if (i >= 0) flow[i] = { ...flow[i], state: 'waiting', result: 'On hold' };
  }
  return flow;
}
