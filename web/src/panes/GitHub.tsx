import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, send, useStore } from '../store';
import { Icon } from '../Icon';
import { Markdown } from './Chat';
import { Confirm, type ConfirmRequest } from '../Confirm';
import type { CheckState, PullRequest, PullRequestDetail } from '../../../shared/protocol';
import '../github.css';

type List = { cwd: string; prs: PullRequest[]; error: string; loading: boolean };
let list: List = { cwd: '', prs: [], error: '', loading: false };
const subs = new Set<() => void>();
const setList = (p: Partial<List>) => {
  list = { ...list, ...p };
  subs.forEach((f) => f());
};
const useList = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => list);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function call<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(api(path), body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const data = await r.json().catch(() => ({ error: `Request failed (${r.status})` }));
  if (!r.ok || data?.error) throw new Error(data?.error ?? `Request failed (${r.status})`);
  return data;
}

let inflight = '';
async function load(cwd: string, fresh = false) {
  if (!cwd || (inflight === cwd && !fresh)) return;
  inflight = cwd;
  setList(list.cwd === cwd ? { loading: true } : { cwd, prs: [], error: '', loading: true });
  try {
    const prs = await call<PullRequest[]>(`/api/gh/prs${fresh ? '?fresh=1' : ''}`);
    if (list.cwd === cwd) setList({ prs, error: '', loading: false });
  } catch (e) {
    if (list.cwd === cwd) setList({ prs: [], error: message(e), loading: false });
  } finally {
    if (inflight === cwd) inflight = '';
  }
}

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 10080) return `${Math.round(m / 1440)}d`;
  return `${Math.round(m / 10080)}w`;
}

const initials = (login: string) => (login.replace(/^app\//, '').match(/[A-Za-z0-9]+/g) ?? ['?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const CHECKS: Record<CheckState, string> = { success: 'Checks passed', failure: 'Checks failed', pending: 'Checks running', none: 'No checks' };
const REVIEW: Record<string, [string, string]> = {
  APPROVED: ['Approved', 'ok'],
  CHANGES_REQUESTED: ['Changes requested', 'bad'],
  REVIEW_REQUIRED: ['Review required', ''],
  COMMENTED: ['Commented', ''],
  DISMISSED: ['Dismissed', ''],
  PENDING: ['Pending', ''],
};

function Chip({ pr }: { pr: PullRequest }) {
  if (pr.draft) return <span className="gh-chip">Draft</span>;
  const r = REVIEW[pr.review];
  return r ? <span className={`gh-chip ${r[1]}`}>{r[0]}</span> : null;
}

const Dot = ({ state }: { state: CheckState }) => <span className={`gh-dot ${state}`} title={CHECKS[state]} />;
const Counts = ({ a, d }: { a: number; d: number }) => <span className="gh-counts"><span className="add">+{a}</span> <span className="del">-{d}</span></span>;

function Row({ pr, onOpen }: { pr: PullRequest; onOpen: () => void }) {
  return (
    <div className="gh-pr" onClick={onOpen} title={`#${pr.number} ${pr.title}\n${pr.author} · ${pr.branch}`}>
      <div className="gh-line">
        <Dot state={pr.checks} />
        <span className="gh-num">#{pr.number}</span>
        <span className="gh-title">{pr.title}</span>
        <span className="gh-when">{ago(pr.updatedAt)}</span>
      </div>
      <div className="gh-line sub">
        <span className="gh-avatar" title={pr.author}>{initials(pr.author)}</span>
        <span className="gh-branch">{pr.branch}</span>
        <Chip pr={pr} />
        <Counts a={pr.additions} d={pr.deletions} />
      </div>
    </div>
  );
}

function Section({ title, prs, onOpen }: { title: string; prs: PullRequest[]; onOpen: (p: PullRequest) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="gh-section" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span>{title}</span>
        <span className="gh-count">{prs.length}</span>
      </div>
      {open && (prs.length ? prs.map((p) => <Row key={p.number} pr={p} onOpen={() => onOpen(p)} />) : <div className="gh-empty">None</div>)}
    </>
  );
}

export function GitHubBadge() {
  const cwd = useStore((s) => s.session.cwd);
  const { prs } = useList();
  useEffect(() => {
    void load(cwd);
    const t = setInterval(() => load(cwd), 5 * 60_000);
    return () => clearInterval(t);
  }, [cwd]);
  const n = prs.filter((p) => p.reviewRequested).length;
  return n > 0 ? <span className="badge">{n}</span> : null;
}

export function GitHub() {
  const cwd = useStore((s) => s.session.cwd);
  const { prs, error, loading } = useList();
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOpen(null);
    void load(cwd);
    const t = setInterval(() => document.visibilityState === 'visible' && root.current?.offsetParent && load(cwd, true), 60_000);
    return () => clearInterval(t);
  }, [cwd]);
  const pr = prs.find((p) => p.number === open);

  return (
    <div className="gh" ref={root}>
      {pr ? (
        <Detail key={pr.number} pr={pr} onBack={() => setOpen(null)} />
      ) : (
        <>
          <div className="gh-bar">
            <span className="muted small">{loading ? 'Loading…' : `${prs.length} open`}</span>
            <span className="spacer" />
            <button className="icon-btn" title="Refresh" disabled={loading} onClick={() => load(cwd, true)}><Icon name="refresh" small spin={loading} /></button>
          </div>
          {error ? (
            <div className="gh-error"><Icon name="error" small /> {error}</div>
          ) : (
            <div className="gh-list">
              <Section title="Waiting for my review" prs={prs.filter((p) => p.reviewRequested)} onOpen={(p) => setOpen(p.number)} />
              <Section title="My PRs" prs={prs.filter((p) => p.mine)} onOpen={(p) => setOpen(p.number)} />
              <Section title="All open" prs={prs} onOpen={(p) => setOpen(p.number)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function splitDiff(diff: string) {
  const files = new Map<string, string>();
  for (const part of diff.split(/^(?=diff --git )/m)) {
    const m = part.match(/^diff --git a\/.* b\/(.*)$/m);
    if (m) files.set(m[1], part.slice(part.indexOf('\n@@') + 1 || part.length));
  }
  return files;
}

function Detail({ pr, onBack }: { pr: PullRequest; onBack: () => void }) {
  const cwd = useStore((s) => s.session.cwd);
  const [d, setD] = useState<PullRequestDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [text, setText] = useState('');
  const [method, setMethod] = useState('squash');
  const [file, setFile] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const diffs = useMemo(() => splitDiff(d?.diff ?? ''), [d?.diff]);

  const fetchDetail = () => call<PullRequestDetail>(`/api/gh/pr/${pr.number}`).then(setD, (e) => setError(message(e)));
  useEffect(() => void fetchDetail(), []);

  const act = async (label: string, path: string, body: object) => {
    setBusy(label);
    setError('');
    try {
      await call(`/api/gh/pr/${pr.number}/${path}`, body);
      if (path === 'review') setText('');
      await Promise.all([fetchDetail(), load(cwd, true)]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };
  const review = (event: string) => act(event, 'review', { event, body: text });
  const askClaude = () =>
    send({ type: 'prompt', text: `Review PR #${pr.number} (${pr.url}): "${pr.title}". Read it with \`gh pr view ${pr.number}\` and \`gh pr diff ${pr.number}\`, then list correctness bugs and risky changes with file and line references. Do not post anything to GitHub.` });

  return (
    <div className="gh-detail">
      <div className="gh-bar">
        <button className="icon-btn" title="Back" onClick={onBack}><Icon name="arrow-left" small /></button>
        <span className="gh-num">#{pr.number}</span>
        <span className="spacer" />
        <a className="icon-btn" href={pr.url} target="_blank" rel="noreferrer" title="Open on GitHub"><Icon name="link-external" small /></a>
      </div>
      <div className="gh-scroll">
        <div className="gh-head">
          <div className="gh-heading">{pr.title}</div>
          <div className="gh-line sub">
            <span className="gh-avatar">{initials(pr.author)}</span>
            <span>{pr.author}</span>
            <Chip pr={pr} />
            <Counts a={pr.additions} d={pr.deletions} />
          </div>
          <div className="gh-line sub"><Icon name="git-branch" small /><span className="gh-branch">{pr.branch}</span></div>
        </div>

        <div className="gh-actions">
          <button className="primary" disabled={!!busy} onClick={() => setAsk({ title: `Approve #${pr.number}?`, detail: pr.title, action: 'Approve', icon: 'check', run: () => review('approve') })}>Approve</button>
          <button disabled={!!busy || !text.trim()} title={text.trim() ? '' : 'Write a comment first'} onClick={() => review('request_changes')}>Request changes</button>
          <button disabled={!!busy || !text.trim()} title={text.trim() ? '' : 'Write a comment first'} onClick={() => review('comment')}>Comment</button>
        </div>
        <textarea className="gh-text" placeholder="Leave a comment" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        <div className="gh-actions">
          <span className="gh-merge">
            <button disabled={!!busy} onClick={() => setAsk({ title: `Merge #${pr.number}?`, detail: pr.title, warning: `Merges ${pr.branch} (${method === 'merge' ? 'merge commit' : method}).`, action: 'Merge', icon: 'git-merge', run: () => act('merge', 'merge', { method }) })}>
              <Icon name="git-merge" small /> Merge
            </button>
            <select value={method} onChange={(e) => setMethod(e.target.value)} title="Merge method">
              <option value="squash">Squash</option>
              <option value="merge">Merge commit</option>
              <option value="rebase">Rebase</option>
            </select>
          </span>
          <button disabled={!!busy} title={`Check out ${pr.branch} in this folder`} onClick={() => act('checkout', 'checkout', {})}><Icon name="git-branch" small /> Checkout</button>
          <button className="gh-claude" title="Send a review prompt to the chat" onClick={askClaude}><Icon name="sparkle" small /> Ask Claude to review</button>
        </div>
        {busy && <div className="muted small gh-pad"><Icon name="loading" small spin /> Running {busy.replace('_', ' ')}…</div>}
        {error && <div className="gh-error"><Icon name="error" small /> {error}</div>}

        {!d ? (
          !error && <div className="muted small gh-pad">Loading…</div>
        ) : (
          <>
            <div className="gh-section static">Description</div>
            <div className="gh-pad">{d.body.trim() ? <Markdown text={d.body} /> : <span className="muted">No description</span>}</div>

            <div className="gh-section static">Checks <span className="gh-count">{d.checks.length}</span></div>
            {d.checks.map((c, i) => (
              <a key={i} className="gh-item" href={c.url || undefined} target="_blank" rel="noreferrer"><Dot state={c.state} /><span className="gh-title">{c.name}</span></a>
            ))}

            <div className="gh-section static">Reviews <span className="gh-count">{d.reviews.length}</span></div>
            {d.reviews.map((r, i) => (
              <div key={i} className="gh-review">
                <div className="gh-line sub">
                  <span className="gh-avatar">{initials(r.author)}</span>
                  <span>{r.author}</span>
                  {REVIEW[r.state] && <span className={`gh-chip ${REVIEW[r.state][1]}`}>{REVIEW[r.state][0]}</span>}
                  <span className="gh-when">{ago(r.at)}</span>
                </div>
                {r.body && <Markdown text={r.body} />}
              </div>
            ))}

            <div className="gh-section static">Commits <span className="gh-count">{d.commits.length}</span></div>
            {d.commits.map((c) => (
              <div key={c.oid} className="gh-item"><span className="mono muted">{c.oid.slice(0, 7)}</span><span className="gh-title">{c.message}</span></div>
            ))}

            <div className="gh-section static">Files changed <span className="gh-count">{d.files.length}</span></div>
            {d.files.map((f) => (
              <div key={f.path}>
                <div className="gh-item click" onClick={() => setFile(file === f.path ? null : f.path)} title={f.path}>
                  <Icon name={file === f.path ? 'chevron-down' : 'chevron-right'} small />
                  <span className="gh-title rtl">{f.path}</span>
                  <Counts a={f.additions} d={f.deletions} />
                </div>
                {file === f.path && (
                  <pre className="gh-diff">{(diffs.get(f.path) ?? 'No diff').split('\n').map((l, i) => <div key={i} className={l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>{l || ' '}</div>)}</pre>
                )}
              </div>
            ))}
          </>
        )}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
