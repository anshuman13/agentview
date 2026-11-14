import { NotFound, parseObject } from '../json.js';
import type { AutoMerge, Method } from './automerge.js';
import type { CheckState, PullRequest, PullRequestDetail } from '../../../shared/protocol.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exec as run } from '../exec.js';

const LIST = 'number,title,author,headRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,url,headRefOid,additions,deletions';
const lists = new Map<string, { at: number; prs: PullRequest[] }>();
const refreshing = new Map<string, Promise<PullRequest[]>>();
const details = new Map<string, { updatedAt: string; detail: Promise<PullRequestDetail> }>();
const PREFETCH = 5;
const KEEP = 20;
const keys = new Map<string, string>();

// Worktrees of one repo share a key, so their chats share one PR list and detail cache.
export function repoKey(cwd: string) {
  let k = keys.get(cwd);
  if (k !== undefined) return k;
  k = cwd;
  try {
    const gitdir = readFileSync(path.join(cwd, '.git'), 'utf8').match(/^gitdir: (.+)$/m)?.[1].trim();
    if (gitdir) {
      const dir = path.resolve(cwd, gitdir);
      k = path.dirname(path.resolve(dir, readFileSync(path.join(dir, 'commondir'), 'utf8').trim()));
    }
  } catch {}
  keys.set(cwd, k);
  return k;
}

const ENV = { ...process.env, GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1' };

export async function gh(cwd: string, ...args: string[]) {
  try {
    return (await run('gh', args, { cwd, maxBuffer: 64 * 1024 * 1024, env: ENV, timeout: 60_000 })).stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new Error('The GitHub CLI is not installed. Install it with: brew install gh');
    const text = e.stderr?.trim() || e.message;
    if (/gh auth login|not logged in/i.test(text)) throw new Error('The GitHub CLI is not logged in. Run: gh auth login');
    if (/no git remotes|not a git repository|none of the git remotes/i.test(text)) throw new Error('This folder has no GitHub remote');
    throw new Error(text);
  }
}

export type Check = { conclusion?: string; state?: string; status?: string; name?: string; context?: string; detailsUrl?: string; targetUrl?: string };

export const checkState = (c: Check): CheckState => {
  const v = (c.conclusion || c.state || c.status || '').toUpperCase();
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v)) return 'success';
  if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) return 'failure';
  return 'pending';
};

function rollup(checks: Check[] = []): CheckState {
  const states = checks.map(checkState);
  if (!states.length) return 'none';
  return states.includes('failure') ? 'failure' : states.includes('pending') ? 'pending' : 'success';
}

const list = async (cwd: string, ...extra: string[]) => JSON.parse(await gh(cwd, 'pr', 'list', '--json', LIST, '--limit', '30', ...extra));

// Bumped when a PR changes here, so a list fetched before it is not stored.
const generation = new Map<string, number>();
const changedHere = (cwd: string) => {
  generation.set(repoKey(cwd), (generation.get(repoKey(cwd)) ?? 0) + 1);
  lists.delete(repoKey(cwd));
  refreshing.delete(repoKey(cwd));
};

async function fetchList(cwd: string): Promise<PullRequest[]> {
  const gen = generation.get(repoKey(cwd));
  const [all, mine, requested] = await Promise.all([list(cwd), list(cwd, '--author', '@me'), list(cwd, '--search', 'user-review-requested:@me')]);
  const byNumber = new Map<number, PullRequest>();
  for (const p of [...all, ...mine, ...requested]) {
    byNumber.set(p.number, {
      number: p.number,
      title: p.title,
      author: p.author?.login ?? '',
      branch: p.headRefName,
      draft: p.isDraft,
      review: p.reviewDecision ?? '',
      checks: rollup(p.statusCheckRollup),
      updatedAt: p.updatedAt,
      url: p.url,
      sha: p.headRefOid ?? '',
      additions: p.additions,
      deletions: p.deletions,
      mine: mine.some((m: { number: number }) => m.number === p.number),
      reviewRequested: requested.some((m: { number: number }) => m.number === p.number),
    });
  }
  const prs = [...byNumber.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (gen !== generation.get(repoKey(cwd))) return prs;
  lists.set(repoKey(cwd), { at: Date.now(), prs });
  for (const p of prs) if (details.get(key(cwd, p.number))?.updatedAt !== p.updatedAt) details.delete(key(cwd, p.number));
  return prs;
}

function refresh(cwd: string) {
  let p = refreshing.get(repoKey(cwd));
  if (!p) {
    const mine: Promise<PullRequest[]> = fetchList(cwd).finally(() => refreshing.get(repoKey(cwd)) === mine && refreshing.delete(repoKey(cwd)));
    refreshing.set(repoKey(cwd), (p = mine));
  }
  return p;
}

// The last list is served at once, however old; a refresh runs behind it when it is over 30 s old.
export function listPrs(cwd: string, fresh = false): Promise<PullRequest[]> {
  const hit = lists.get(repoKey(cwd));
  if (fresh || !hit) return refresh(cwd);
  if (Date.now() - hit.at > 30_000) refresh(cwd).catch(() => {});
  return Promise.resolve(hit.prs);
}

let auto: AutoMerge | undefined;
export const useAutoMerge = (a: AutoMerge) => void (auto = a);
export const forgetPrs = changedHere;

const polled = new Map<string, number>();

// The check state of a PR from the last list of its repo, for rows that cannot wait on gh; the list is refetched at most every 5 min per repo, and changed runs after each fetch.
export function prChecks(cwd: string, number: number, changed: () => void): CheckState | undefined {
  if (Date.now() - (polled.get(repoKey(cwd)) ?? 0) > 5 * 60_000) {
    polled.set(repoKey(cwd), Date.now());
    refresh(cwd).then(changed, () => {});
  }
  return lists.get(repoKey(cwd))?.prs.find((p) => p.number === number)?.checks;
}

const key = (cwd: string, n: number | string) => `${repoKey(cwd)}#${n}`;

function detail(cwd: string, pr: { number: number; updatedAt: string }) {
  const k = key(cwd, pr.number);
  const hit = details.get(k);
  if (hit && hit.updatedAt === pr.updatedAt) return hit.detail;
  const d = prDetail(cwd, String(pr.number));
  details.set(k, { updatedAt: pr.updatedAt, detail: d });
  d.catch(() => details.delete(k));
  while (details.size > KEEP) details.delete(details.keys().next().value!);
  return d;
}

export type Issue = { number: number; title: string; url: string; updatedAt: string };

export async function listIssues(cwd: string): Promise<Issue[]> {
  return JSON.parse(await gh(cwd, 'issue', 'list', '--assignee', '@me', '--json', 'number,title,url,updatedAt', '--limit', '30'));
}

type Author = { login?: string; name?: string };

async function prDetail(cwd: string, n: string): Promise<PullRequestDetail> {
  const [view, diff] = await Promise.all([gh(cwd, 'pr', 'view', n, '--json', 'body,reviews,comments,files,commits,statusCheckRollup'), gh(cwd, 'pr', 'diff', n)]);
  const d = JSON.parse(view);
  const reviews = [
    ...d.reviews.filter((r: { state: string; body: string }) => r.body || r.state !== 'COMMENTED').map((r: { author: Author; state: string; body: string; submittedAt: string }) => ({ author: r.author?.login ?? '', state: r.state, body: r.body, at: r.submittedAt })),
    ...d.comments.map((c: { author: Author; body: string; createdAt: string }) => ({ author: c.author?.login ?? '', state: 'COMMENTED', body: c.body, at: c.createdAt })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return {
    body: d.body,
    checks: (d.statusCheckRollup as Check[]).map((c) => ({ name: c.name || c.context || '', state: checkState(c), url: c.detailsUrl || c.targetUrl || '' })),
    reviews,
    files: d.files.map((f: { path: string; additions: number; deletions: number }) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    commits: d.commits.map((c: { oid: string; messageHeadline: string; authors: Author[] }) => ({ oid: c.oid, message: c.messageHeadline, author: c.authors[0]?.login || c.authors[0]?.name || '' })),
    diff: diff.length > 2_000_000 ? diff.slice(0, 2_000_000) : diff,
  };
}

const REVIEW: Record<string, string> = { approve: '--approve', comment: '--comment', request_changes: '--request-changes' };
const MERGE: Record<string, string> = { squash: '--squash', merge: '--merge', rebase: '--rebase' };

async function act(cwd: string, n: string, verb: string, ...flags: string[]) {
  await gh(cwd, 'pr', verb, n, ...flags);
  changedHere(cwd);
  details.delete(key(cwd, n));
  return { ok: true };
}

export async function github(cwd: string, method: string, url: URL, readBody: () => Promise<string>) {
  const pathname = url.pathname;
  const [, , , what, n, action] = pathname.split('/');
  if (what === 'prs' && method === 'GET') {
    const prs = await listPrs(cwd, url.searchParams.has('fresh'));
    // Only the PR view reads details, so only its list loads them ahead.
    for (const p of prs.filter((p) => p.reviewRequested).slice(0, PREFETCH)) detail(cwd, p).catch(() => {});
    const armed = await auto?.state(cwd);
    return armed?.size ? prs.map((p) => (armed.has(p.number) ? { ...p, autoMerge: armed.get(p.number) } : p)) : prs;
  }
  if (what !== 'pr' || !/^\d+$/.test(n ?? '')) throw new NotFound(`Unknown GitHub route ${pathname}`);
  if (method === 'GET' && !action) {
    const pr = lists.get(repoKey(cwd))?.prs.find((p) => p.number === Number(n));
    return pr ? detail(cwd, pr) : prDetail(cwd, n);
  }
  if (method !== 'POST') throw new NotFound(`Unknown GitHub route ${pathname}`);
  const body = parseObject(await readBody());
  if (action === 'review') {
    const flag = REVIEW[body.event];
    const text = String(body.body ?? '').trim();
    if (!flag) throw new Error('Review event must be approve, comment or request_changes');
    if (!text && body.event !== 'approve') throw new Error('Write a comment first');
    return act(cwd, n, 'review', flag, ...(text ? ['--body', text] : []));
  }
  if (action === 'merge') return act(cwd, n, 'merge', MERGE[body.method] ?? '--squash');
  if (action === 'automerge') {
    if (!auto) throw new Error('Auto-merge is not running');
    if (typeof body.method !== 'string' || !Object.hasOwn(MERGE, body.method)) throw new Error('Method must be squash, merge or rebase');
    return auto.turn(cwd, Number(n), body.on === true, body.method as Method);
  }
  if (action === 'checkout') return act(cwd, n, 'checkout');
  throw new NotFound(`Unknown GitHub route ${pathname}`);
}

// The URL of the PR of a branch, or undefined when it has none.
export async function prForBranch(cwd: string, branch: string): Promise<string | undefined> {
  try {
    return JSON.parse(await gh(cwd, 'pr', 'view', branch, '--json', 'url')).url;
  } catch (err) {
    if (/no pull requests? found/i.test((err as Error).message)) return undefined;
    throw err;
  }
}

export async function openPr(cwd: string, branch: string, base: string, title: string, body: string) {
  const out = await gh(cwd, 'pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body);
  lists.delete(repoKey(cwd));
  return out.trim().split('\n').pop()!;
}
