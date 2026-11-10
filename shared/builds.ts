import type { AgentStatus } from './protocol.js';

export type BuildStage = 'pm' | 'review' | 'implement' | 'test' | 'code-review';
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
};
export type BuildSummary = { stage: BuildStage; state: BuildState; conclusion: string };
export type Criterion = { n: number; result: 'pass' | 'fail' | 'unverified'; evidence: string };
export type BuildRow = BuildSummary & { slug: string; title: string; updatedAt: number };
export type BuildDetail = {
  slug: string;
  title: string;
  summary: BuildSummary;
  spec: string | null;
  entries: (BuildEntry & { verdict: string | null; criteria: Criterion[]; findings: string[] })[];
  commit: { files: { path: string; add: number; del: number }[]; diff: string } | null;
};

const HAND: Record<string, BuildStage> = { pm: 'pm', 'spec-reviewer': 'review', implementer: 'implement', tester: 'test', 'code-reviewer': 'code-review' };
const LABEL: Record<string, BuildStage> = { pm: 'pm', review: 'review', impl: 'implement', test: 'test', 'code-review': 'code-review' };
const STAGE_NAME: Record<BuildStage, string> = { pm: 'Spec', review: 'Spec review', implement: 'Implement', test: 'Test', 'code-review': 'Code review' };

export const stageName = (stage: BuildStage) => STAGE_NAME[stage];

export const slugOk = (slug: string | undefined): slug is string => Boolean(slug) && !slug!.includes('..');

// The stage and slug a build agent works on: a /build label like `impl:<slug>#2`, else a hand run named by its spec path. `round` is the label's numeric #N.
export function buildStageOf(subagentType: string, description: string, prompt: string): { stage: BuildStage; slug: string; round: number | null } | null {
  const label = /^(pm|review|impl|test|code-review):([\w.-]+)(?:#(\w+))?$/.exec(description.trim());
  if (label && slugOk(label[2])) return { stage: LABEL[label[1]], slug: label[2], round: label[3] && /^\d+$/.test(label[3]) ? Number(label[3]) : null };
  const stage = HAND[subagentType];
  const slug = /\.claude\/specs\/([\w.-]+?)\.md/.exec(prompt)?.[1];
  return stage && slugOk(slug) ? { stage, slug, round: null } : null;
}

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

// `merged`: the latest implement commit reached the default branch.
export function buildSummary(entries: BuildEntry[], merged: boolean): BuildSummary {
  const all = entries.map((e, i) => [e, i] as const).sort((a, b) => a[0].startedAt - b[0].startedAt || a[1] - b[1]).map(([e]) => e);
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
  const conclusion = !impl.commit ? 'No commit found' : merged ? `Merged as ${impl.commit.sha.slice(0, 7)}` : 'Passed · not merged yet';
  return { stage: tail.stage, state: 'done', conclusion };
}
