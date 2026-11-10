import type { Dirent } from 'node:fs';
import { appendFile, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REVIEW_PHASES, buildStageOf, buildSummary, criteriaOf, decisionTitle, findingsOf, phaseLabel, pipelineOf, slugOk, verdictOf, type BuildCommit, type BuildEntry, type BuildPhase, type BuildReview, type BuildStage, type BuildSummary, type ReviewPhase } from '../../../shared/builds.js';
import type { ChatEvent } from '../../../shared/protocol.js';
import { jsonFile, readJson } from '../json.js';
import { MAX_BRANCH_DIFF, defaultBase, git, parseNumstat } from '../workspace/git.js';
import { mainCheckout } from '../workspace/tries.js';
import type { AgentSession } from './session.js';

const MAX_REPORT = 20_000;
const MAX_NOTE = 2000;

const buildsDir = (repo: string) => path.join(process.env.AGENTVIEW_BUILDS ?? path.join(os.homedir(), '.agentview', 'builds'), encodeURIComponent(repo));

// The first 7 to 40 char hex token of a report that is a commit of the repo, with what the commit changed.
async function commitIn(repo: string, report: string): Promise<BuildCommit | undefined> {
  for (const token of report.match(/\b[0-9a-f]{7,40}\b/g) ?? []) {
    if ((await git(repo, ['cat-file', '-t', token]).catch(() => '')).trim() !== 'commit') continue;
    const [info, numstat, refs] = await Promise.all([
      git(repo, ['show', '-s', '--format=%H%x09%ct%x09%s', token]),
      git(repo, ['show', '--numstat', '--format=', token]),
      git(repo, ['for-each-ref', '--points-at', token, '--format=%(refname:short)']),
    ]);
    const [sha, date, ...subject] = info.trim().split('\t');
    return { sha, subject: subject.join('\t'), date: Number(date) * 1000, branch: refs.split('\n')[0] || null, files: parseNumstat(numstat).map((f) => ({ path: f.path, additions: f.add, deletions: f.del })) };
  }
}

type Snap = { id: string; stage: BuildStage; slug: string; round: number | null; status: BuildEntry['status']; startedAt: number; endedAt: number | null; report?: string; chat: string; session: string | null; cwd: string };

async function write(s: Snap) {
  const repo = await mainCheckout(s.cwd);
  await jsonFile<BuildEntry[]>(path.join(buildsDir(repo), `${s.slug}.json`), []).update(async (cur) => {
    const old = cur.find((e) => e.id === s.id);
    const report = s.report ?? old?.report ?? '';
    const commit = s.stage !== 'implement' ? undefined : old?.commit && old.report === report ? old.commit : report ? await commitIn(repo, report) : undefined;
    const entry: BuildEntry = {
      id: s.id, stage: s.stage, round: old?.round ?? s.round ?? cur.filter((e) => e.stage === s.stage).length + 1,
      status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, report, chat: s.chat, session: s.session, ...(commit && { commit }),
    };
    return old ? cur.map((e) => (e === old ? entry : e)) : [...cur, entry];
  });
}

// Records run in the order they were emitted, so a hand-back's second emit never lands before its first.
let queue: Promise<unknown> = Promise.resolve();
// A running agent re-emits its event on every progress tick; only a status change is worth a write.
const lastStatus = new Map<string, string>();

// A build agent's start, end or report, from the event the chat emits.
export function recordBuild(session: AgentSession, ev: ChatEvent) {
  const agent = ev.kind === 'agent' ? ev : ev.kind === 'tool_result' ? session.log.agent(ev.toolUseId) : undefined;
  const target = agent && buildStageOf(agent.subagentType, agent.description, agent.prompt);
  if (!agent || !target) return;
  if (ev.kind === 'agent' && lastStatus.get(agent.toolUseId) === agent.status) return;
  lastStatus.set(agent.toolUseId, agent.status);
  const report = ev.kind === 'tool_result' && agent.status !== 'running' ? ev.text.slice(0, MAX_REPORT) : undefined;
  const snap: Snap = { ...target, id: agent.toolUseId, status: agent.status, startedAt: agent.startedAt, endedAt: agent.endedAt, report, chat: session.id, session: session.state.session.sessionId, cwd: session.cwd };
  queue = queue.then(() => write(snap)).catch(() => {});
}

const SLUG = /^\w[\w.-]*$/;

const slugValid = (slug: string) => SLUG.test(slug) && slugOk(slug);

const readEntries = (repo: string, slug: string) => readJson<BuildEntry[]>(path.join(buildsDir(repo), `${slug}.json`), []);

const reviewsPath = (repo: string, slug: string) => path.join(buildsDir(repo), `${slug}.reviews.json`);

const readReviews = (repo: string, slug: string) => readJson<BuildReview[]>(reviewsPath(repo, slug), []);

// jsonFile serialises writes per instance, so every write to one file goes through the same one.
const reviewStores = new Map<string, ReturnType<typeof jsonFile<BuildReview[]>>>();

const reviewStore = (repo: string, slug: string) => {
  const file = reviewsPath(repo, slug);
  if (!reviewStores.has(file)) reviewStores.set(file, jsonFile<BuildReview[]>(file, []));
  return reviewStores.get(file)!;
};

const titleOf = (spec: string | null, slug: string) => /^# (.+)$/m.exec(spec ?? '')?.[1].trim() || slug;

const PHASE_OF = new Map<string, ReviewPhase>([
  ['problem', 'requirements'], ['behaviour', 'requirements'], ['requirements', 'requirements'], ['non-goals', 'requirements'],
  ['design', 'design'], ['touches', 'design'], ['open questions', 'design'],
  ['tasks', 'tasks'], ['acceptance criteria', 'tasks'],
]);
const NOTES = 'review notes';

// The text above the first level-2 heading, then one section per `## ` heading (lowercased), fenced code skipped.
function sectionsOf(markdown: string) {
  const sections: { heading: string | null; lines: string[] }[] = [{ heading: null, lines: [] }];
  let fence = '';
  for (const line of markdown.split('\n')) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) fence = !fence ? mark : mark[0] === fence[0] && mark.length >= fence.length ? '' : fence;
    const heading = !fence && !mark ? /^## +(.+?)\s*$/.exec(line)?.[1] : undefined;
    if (heading) sections.push({ heading: heading.toLowerCase(), lines: [] });
    sections.at(-1)!.lines.push(line);
  }
  return sections;
}

export function splitPhases(markdown: string): BuildPhase[] {
  const lines: Record<ReviewPhase, string[]> = { requirements: [], design: [], tasks: [] };
  let phase: ReviewPhase | null = 'requirements';
  for (const s of sectionsOf(markdown)) {
    if (s.heading !== null) phase = s.heading === NOTES ? null : PHASE_OF.get(s.heading) ?? phase;
    if (phase) lines[phase].push(...s.lines);
  }
  return REVIEW_PHASES.map((key) => ({ key, markdown: lines[key].join('\n').trim() })).filter((p) => p.markdown);
}

const withoutNotes = (markdown: string) => sectionsOf(markdown).filter((s) => s.heading !== NOTES).flatMap((s) => s.lines).join('\n').trim();

type Spec = { title: string; phases: BuildPhase[]; mtime: number; file: string; kiro: boolean };

// A spec file in .claude/specs, else a Kiro folder in .kiro/specs with one file per phase.
async function loadSpec(repo: string, slug: string): Promise<Spec | null> {
  const file = path.join(repo, '.claude', 'specs', `${slug}.md`);
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text !== null) return { title: titleOf(text, slug), phases: splitPhases(text), mtime: Math.round((await stat(file)).mtimeMs), file, kiro: false };
  const parts = await Promise.all(REVIEW_PHASES.map(async (key) => {
    const f = path.join(repo, '.kiro', 'specs', slug, `${key}.md`);
    const [body, st] = await Promise.all([readFile(f, 'utf8').catch(() => null), stat(f).catch(() => null)]);
    return { key, file: f, body, mtime: Math.round(st?.mtimeMs ?? 0) };
  }));
  const first = parts.find((p) => p.body !== null);
  if (!first) return null;
  const phases = parts.flatMap((p) => (p.body === null ? [] : [{ key: p.key, markdown: withoutNotes(p.body) }])).filter((p) => p.markdown);
  return { title: titleOf(parts[0].body, slug), phases, mtime: Math.max(...parts.map((p) => p.mtime)), file: first.file, kiro: true };
}

const DRAFT: BuildSummary = { stage: 'pm', state: 'done', conclusion: 'Not started' };

const names = async (dir: string, keep: (f: Dirent) => string | null) => (await readdir(dir, { withFileTypes: true }).catch(() => [])).flatMap((f) => keep(f) ?? []);

const lastCommit = (entries: BuildEntry[]) => entries.filter((e) => e.stage === 'implement').at(-1)?.commit;

// The default branch holds a commit with this subject made after the build's commit: the build was cherry-picked or merged.
async function merged(repo: string, commit: BuildCommit | undefined) {
  if (!commit) return false;
  const base = (await defaultBase(repo)).replace(/^origin\//, '');
  const log = await git(repo, ['log', base, '--fixed-strings', `--grep=${commit.subject}`, '--format=%ct%x09%s']).catch(() => '');
  return log.split('\n').some((l) => Number(l.split('\t')[0]) * 1000 > commit.date && l.split('\t').slice(1).join('\t') === commit.subject);
}

export async function listBuilds(cwd: string) {
  const repo = await mainCheckout(cwd).catch(() => null);
  if (!repo) return [];
  const [recorded, claude, kiro] = await Promise.all([
    names(buildsDir(repo), (f) => (f.name.endsWith('.json') && !f.name.endsWith('.reviews.json') ? f.name.slice(0, -5) : null)),
    names(path.join(repo, '.claude', 'specs'), (f) => (f.name.endsWith('.md') ? f.name.slice(0, -3) : null)),
    names(path.join(repo, '.kiro', 'specs'), (f) => (f.isDirectory() ? f.name : null)),
  ]);
  const builds = await Promise.all([...new Set([...recorded, ...claude, ...kiro])].filter(slugValid).map(async (slug) => {
    const [entries, reviews, spec] = await Promise.all([readEntries(repo, slug), readReviews(repo, slug), loadSpec(repo, slug)]);
    const done = await merged(repo, lastCommit(entries));
    return {
      slug, title: spec?.title ?? slug, ...(entries.length ? buildSummary(entries, done) : DRAFT), pipeline: pipelineOf(entries, done, reviews), draft: !entries.length,
      updatedAt: Math.max(spec?.mtime ?? 0, ...entries.map((e) => e.endedAt ?? e.startedAt)),
    };
  }));
  return builds.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function buildOne(cwd: string, slug: string) {
  const repo = await mainCheckout(cwd).catch(() => null);
  const [entries, reviews, spec] = repo && slugValid(slug) ? await Promise.all([readEntries(repo, slug), readReviews(repo, slug), loadSpec(repo, slug)]) : [[], [], null];
  if (!repo || (!entries.length && !spec)) return { status: 404, body: { error: 'No such build' } };
  const commit = lastCommit(entries);
  const done = await merged(repo, commit);
  const [numstat, diff] = commit ? await Promise.all([git(repo, ['show', '--numstat', '--format=', commit.sha]), git(repo, ['show', '--format=', commit.sha])]).catch(() => ['', '']) : ['', ''];
  return {
    slug,
    title: spec?.title ?? slug,
    summary: entries.length ? buildSummary(entries, done) : DRAFT,
    pipeline: pipelineOf(entries, done, reviews),
    updatedAt: Math.max(spec?.mtime ?? 0, ...entries.map((e) => e.endedAt ?? e.startedAt)),
    specFile: spec && !spec.kiro ? `.claude/specs/${slug}.md` : null,
    phases: spec?.phases ?? [],
    reviews,
    entries: entries.map((e) => ({ ...e, verdict: verdictOf(e.report), criteria: criteriaOf(e.report), findings: findingsOf(e.report) })),
    commit: commit ? { files: parseNumstat(numstat), diff: diff.length > MAX_BRANCH_DIFF ? '' : diff } : null,
  };
}

const ignored = (repo: string, file: string) => git(repo, ['check-ignore', '-q', '--', file]).then(() => true, () => false);

const two = (n: number) => String(n).padStart(2, '0');

// One line at the end of the spec file, appended without reading it back for a rewrite so an agent editing it at the same time loses nothing.
async function appendNote(file: string, r: BuildReview) {
  const text = await readFile(file, 'utf8');
  const d = new Date(r.at);
  const lead = sectionsOf(text).some((s) => s.heading === NOTES) ? (text.endsWith('\n') ? '' : '\n') : '\n## Review notes\n';
  const when = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
  await appendFile(file, `${lead}- ${when} ${phaseLabel(r.phase)}: ${decisionTitle(r)}${r.note && `: ${r.note}`}\n`);
}

const isPhase = (v: unknown): v is ReviewPhase => REVIEW_PHASES.includes(v as ReviewPhase);

// The user's decision on one phase of a spec: the JSON record the UI reads, and for a git-ignored spec file also the line agents read.
export async function reviewBuild(cwd: string, body: { slug?: unknown; phase?: unknown; decision?: unknown; note?: unknown }) {
  const { slug, phase, decision } = body;
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : '';
  if (typeof slug !== 'string' || !slugValid(slug) || !isPhase(phase) || (decision !== 'approve' && decision !== 'changes') || (decision === 'changes' && !note)) return { status: 400, body: { error: 'Bad review' } };
  const repo = await mainCheckout(cwd).catch(() => null);
  const spec = repo && (await loadSpec(repo, slug));
  if (!repo || !spec) return { status: 404, body: { error: 'No such spec' } };
  const review: BuildReview = { phase, decision, note, at: Date.now() };
  await reviewStore(repo, slug).update(async (cur) => {
    if (await ignored(repo, spec.file)) await appendNote(spec.file, review);
    return [...cur, review];
  });
  return { ok: true };
}
