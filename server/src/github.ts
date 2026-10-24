import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CheckState, PullRequest, PullRequestDetail } from '../../shared/protocol.js';

const run = promisify(execFile);
const LIST = 'number,title,author,headRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,url,headRefOid,additions,deletions';
const lists = new Map<string, { at: number; prs: PullRequest[] }>();
const refreshing = new Map<string, Promise<PullRequest[]>>();
const details = new Map<string, { updatedAt: string; detail: Promise<PullRequestDetail> }>();
const PREFETCH = 5;
const KEEP = 20;
const ENV = { ...process.env, GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1' };

async function gh(cwd: string, ...args: string[]) {
  try {
    return (await run('gh', args, { cwd, maxBuffer: 64 * 1024 * 1024, env: ENV })).stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new Error('The GitHub CLI is not installed. Install it with: brew install gh');
    const text = e.stderr?.trim() || e.message;
    if (/gh auth login|not logged in/i.test(text)) throw new Error('The GitHub CLI is not logged in. Run: gh auth login');
    if (/no git remotes|not a git repository|none of the git remotes/i.test(text)) throw new Error('This folder has no GitHub remote');
    throw new Error(text);
  }
}

type Check = { conclusion?: string; state?: string; status?: string; name?: string; context?: string; detailsUrl?: string; targetUrl?: string };

const checkState = (c: Check): CheckState => {
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

async function fetchList(cwd: string): Promise<PullRequest[]> {
  const [all, mine, requested] = await Promise.all([list(cwd), list(cwd, '--author', '@me'), list(cwd, '--search', 'review-requested:@me')]);
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
  lists.set(cwd, { at: Date.now(), prs });
  for (const p of prs) if (details.get(key(cwd, p.number))?.updatedAt !== p.updatedAt) details.delete(key(cwd, p.number));
  for (const p of prs.filter((p) => p.reviewRequested).slice(0, PREFETCH)) detail(cwd, p).catch(() => {});
  return prs;
}

function refresh(cwd: string) {
  let p = refreshing.get(cwd);
  if (!p) {
    p = fetchList(cwd).finally(() => refreshing.delete(cwd));
    refreshing.set(cwd, p);
  }
  return p;
}

// The last list is served at once, however old; a refresh runs behind it when it is over 30 s old.
export function listPrs(cwd: string, fresh = false): Promise<PullRequest[]> {
  const hit = lists.get(cwd);
  if (fresh || !hit) return refresh(cwd);
  if (Date.now() - hit.at > 30_000) refresh(cwd).catch(() => {});
  return Promise.resolve(hit.prs);
}

const key = (cwd: string, n: number | string) => `${cwd}#${n}`;

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
  lists.delete(cwd);
  details.delete(key(cwd, n));
  return { ok: true };
}

export async function github(cwd: string, method: string, url: URL, readBody: () => Promise<string>) {
  const pathname = url.pathname;
  const [, , , what, n, action] = pathname.split('/');
  if (what === 'prs' && method === 'GET') return listPrs(cwd, url.searchParams.has('fresh'));
  if (what !== 'pr' || !/^\d+$/.test(n ?? '')) throw new Error(`Unknown GitHub route ${pathname}`);
  if (method === 'GET' && !action) {
    const pr = lists.get(cwd)?.prs.find((p) => p.number === Number(n));
    return pr ? detail(cwd, pr) : prDetail(cwd, n);
  }
  if (method !== 'POST') throw new Error(`Unknown GitHub route ${pathname}`);
  const body = JSON.parse((await readBody()) || '{}');
  if (action === 'review') {
    const flag = REVIEW[body.event];
    const text = String(body.body ?? '').trim();
    if (!flag) throw new Error('Review event must be approve, comment or request_changes');
    if (!text && body.event !== 'approve') throw new Error('Write a comment first');
    return act(cwd, n, 'review', flag, ...(text ? ['--body', text] : []));
  }
  if (action === 'merge') return act(cwd, n, 'merge', MERGE[body.method] ?? '--squash');
  if (action === 'checkout') return act(cwd, n, 'checkout');
  throw new Error(`Unknown GitHub route ${pathname}`);
}
