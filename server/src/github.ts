import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CheckState, PullRequest, PullRequestDetail } from '../../shared/protocol.js';

const run = promisify(execFile);
const LIST = 'number,title,author,headRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,url,additions,deletions';
const cache = new Map<string, { at: number; prs: PullRequest[] }>();

async function gh(cwd: string, ...args: string[]) {
  try {
    return (await run('gh', args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
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

async function listPrs(cwd: string, fresh = false): Promise<PullRequest[]> {
  const hit = cache.get(cwd);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.prs;
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
      additions: p.additions,
      deletions: p.deletions,
      mine: mine.some((m: { number: number }) => m.number === p.number),
      reviewRequested: requested.some((m: { number: number }) => m.number === p.number),
    });
  }
  const prs = [...byNumber.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  cache.set(cwd, { at: Date.now(), prs });
  return prs;
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

async function act(cwd: string, ...args: string[]) {
  await gh(cwd, 'pr', ...args);
  cache.delete(cwd);
  return { ok: true };
}

export async function github(cwd: string, method: string, url: URL, readBody: () => Promise<string>) {
  const pathname = url.pathname;
  const [, , , what, n, action] = pathname.split('/');
  if (what === 'prs' && method === 'GET') return listPrs(cwd, url.searchParams.has('fresh'));
  if (what !== 'pr' || !/^\d+$/.test(n ?? '')) throw new Error(`Unknown GitHub route ${pathname}`);
  if (method === 'GET' && !action) return prDetail(cwd, n);
  if (method !== 'POST') throw new Error(`Unknown GitHub route ${pathname}`);
  const body = JSON.parse((await readBody()) || '{}');
  if (action === 'review') {
    const flag = REVIEW[body.event];
    const text = String(body.body ?? '').trim();
    if (!flag) throw new Error('Review event must be approve, comment or request_changes');
    if (!text && body.event !== 'approve') throw new Error('Write a comment first');
    return act(cwd, 'review', n, flag, ...(text ? ['--body', text] : []));
  }
  if (action === 'merge') return act(cwd, 'merge', n, MERGE[body.method] ?? '--squash');
  if (action === 'checkout') return act(cwd, 'checkout', n);
  throw new Error(`Unknown GitHub route ${pathname}`);
}
