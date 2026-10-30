import { useEffect, useMemo, useState } from 'react';
import { send, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { Block, Findings } from './Findings';
import { Markdown } from '../chat/Chat';
import { FileIcon } from '../workspace/FileIcon';
import { CheckIcon, Counts, StateChip, call, load, message, setViewOpen, useList } from './pulls';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import type { PullRequest, PullRequestDetail } from '../../../shared/protocol';
import { ago, askClaude, pressable } from '../ui/util';
import { Skeleton } from '../ui/Skeleton';

const initials = (login: string) => (login.replace(/^app\//, '').match(/[A-Za-z0-9]+/g) ?? ['?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const SETUP: Array<{ test: RegExp; icon: string; title: string; text: string; cmd?: string }> = [
  { test: /not installed/i, icon: 'terminal', title: 'GitHub CLI not installed', text: 'Install it, then refresh.', cmd: 'brew install gh' },
  { test: /not logged in/i, icon: 'account', title: 'Not signed in to GitHub', text: 'Sign in with the GitHub CLI, then refresh.', cmd: 'gh auth login' },
  { test: /no GitHub remote/i, icon: 'github', title: 'No GitHub remote', text: 'Open a chat in a folder whose repository lives on GitHub.' },
];

const Avatar = ({ login }: { login: string }) => <span className="gh-avatar" title={login}>{initials(login)}</span>;
function Row({ pr, onOpen }: { pr: PullRequest; onOpen: () => void }) {
  const chat = useStore((s) => s.live.find((c) => c.pr === pr.number));
  return (
    <div className="gh-pr" {...pressable(onOpen)} title={`#${pr.number} ${pr.title}`}>
      <CheckIcon state={pr.checks} />
      <div className="gh-title"><span className="gh-title-text">{pr.title}</span><span className="gh-num">#{pr.number}</span></div>
      <div className="gh-meta">
        <span className="gh-author">{pr.author}</span>
        <span className="gh-sep">·</span>
        <span className="gh-branch">{pr.branch}</span>
        <span className="gh-sep">·</span>
        <span className="gh-when">{ago(pr.updatedAt)}</span>
        {chat && <button className="chip outline pill sm gh-open-chat" title={`Open the chat that created this pull request: ${chat.title}`} onClick={(e) => { e.stopPropagation(); send({ type: 'view', id: chat.id }); }}><Icon name="comment" small /> Open chat</button>}
        {pr.draft ? <span className="chip outline pill sm">Draft</span> : <StateChip state={pr.review} />}
      </div>
    </div>
  );
}

function Section({ title, prs, onOpen }: { title: string; prs: PullRequest[]; onOpen: (p: PullRequest) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="section-head" aria-expanded={open} {...pressable(() => setOpen(!open))}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span className="label">{title}</span>
        <span className="badge quiet">{prs.length}</span>
      </div>
      {open && (prs.length ? prs.map((p) => <Row key={p.number} pr={p} onOpen={() => onOpen(p)} />) : <div className="gh-empty">None</div>)}
    </>
  );
}

function Problem({ error }: { error: string }) {
  const setup = SETUP.find((s) => s.test.test(error));
  if (!setup) return <div className="gh-error" role="alert"><Icon name="error" small /> {error}</div>;
  return (
    <div className="empty-state">
      <Icon name={setup.icon} />
      <div className="empty-title">{setup.title}</div>
      <div className="muted small">{setup.text}</div>
      {setup.cmd && <pre className="gh-cmd">{setup.cmd}</pre>}
    </div>
  );
}

function PrList({ onOpen }: { onOpen: (n: number) => void }) {
  const cwd = useStore((s) => s.session.cwd);
  const { prs, error, loading } = useList();
  return (
    <>
      <div className="gh-bar">
        <span className="muted small">{loading && !prs.length ? '' : `${prs.length} open`}</span>
        <span className="spacer" />
        <button className="icon-btn" title="Refresh" disabled={loading} onClick={() => load(cwd, true)}><Icon name="refresh" small spin={loading} /></button>
      </div>
      {error ? (
        <Problem error={error} />
      ) : (
        <div className="gh-list">
          <Section title="Waiting for my review" prs={prs.filter((p) => p.reviewRequested)} onOpen={(p) => onOpen(p.number)} />
          <Section title="My pull requests" prs={prs.filter((p) => p.mine)} onOpen={(p) => onOpen(p.number)} />
          <Section title="All open" prs={prs} onOpen={(p) => onOpen(p.number)} />
        </div>
      )}
    </>
  );
}

export function GitHub() {
  const cwd = useStore((s) => s.session.cwd);
  const { prs } = useList();
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    setOpen(null);
    void load(cwd).then(() => load(cwd, true));
  }, [cwd]);
  useEffect(() => {
    setViewOpen(true);
    return () => setViewOpen(false);
  }, []);
  const pr = prs.find((p) => p.number === open);

  return (
    <div className="gh">
      {pr ? <Detail key={pr.number} pr={pr} onBack={() => setOpen(null)} /> : <PrList onOpen={setOpen} />}
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

const lineClass = (l: string) => (l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l.startsWith('@@') ? 'hunk' : '');

function Review({ r }: { r: PullRequestDetail['reviews'][number] }) {
  return (
    <div className="gh-review">
      <div className="gh-line">
        <Avatar login={r.author} />
        <span className="gh-author">{r.author}</span>
        <StateChip state={r.state} />
        <span className="gh-when">{ago(r.at)}</span>
      </div>
      {r.body && <Markdown text={r.body} />}
    </div>
  );
}

function Files({ files, diffs }: { files: PullRequestDetail['files']; diffs: Map<string, string> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {files.map((f) => {
        const name = f.path.split('/').pop()!;
        const shown = open === f.path;
        return (
          <div key={f.path}>
            <div className="gh-item click" {...pressable(() => setOpen(shown ? null : f.path))} title={f.path}>
              <Icon name={shown ? 'chevron-down' : 'chevron-right'} small />
              <FileIcon name={name} />
              <span className="gh-fname">{name}</span>
              <span className="gh-fdir">{f.path.slice(0, -name.length - 1)}</span>
              <Counts a={f.additions} d={f.deletions} />
            </div>
            {shown && (
              <pre className="gh-diff">{(diffs.get(f.path) ?? 'No diff').split('\n').map((l, i) => <div key={i} className={lineClass(l)}>{l || ' '}</div>)}</pre>
            )}
          </div>
        );
      })}
    </>
  );
}

type Act = (label: string, path: string, body: object) => Promise<boolean>;

function ActionBar({ pr, busy, act, confirm }: { pr: PullRequest; busy: boolean; act: Act; confirm: (c: ConfirmRequest) => void }) {
  const [text, setText] = useState('');
  const [method, setMethod] = useState('squash');
  const needsText = !text.trim();
  const review = async (event: string) => (await act(event, 'review', { event, body: text })) && setText('');
  const approve = () => confirm({ title: `Approve #${pr.number}?`, detail: pr.title, action: 'Approve', icon: 'check', run: () => review('approve') });
  const merge = () =>
    confirm({
      title: `Merge #${pr.number}?`,
      detail: pr.title,
      warning: `Merges ${pr.branch} (${method === 'merge' ? 'merge commit' : method}).`,
      action: 'Merge',
      icon: 'git-merge',
      run: () => act('merge', 'merge', { method }),
    });
  const askReview = () => askClaude(`/code-review ${pr.number}`);

  return (
    <div className="gh-actionbar">
      <textarea className="gh-text" placeholder="Leave a comment" aria-label="Comment" value={text} rows={2} onChange={(e) => setText(e.target.value)} />
      <div className="gh-actions">
        <button className="btn sm primary" disabled={busy} onClick={approve}><Icon name="check" small /> Approve</button>
        <button className="btn sm" disabled={busy || needsText} title={needsText ? 'Write a comment first' : ''} onClick={() => review('request_changes')}><Icon name="request-changes" small /> Request changes</button>
        <button className="btn sm" disabled={busy || needsText} title={needsText ? 'Write a comment first' : ''} onClick={() => review('comment')}><Icon name="comment" small /> Comment</button>
      </div>
      <div className="gh-actions">
        <span className="gh-merge">
          <button className="btn sm" disabled={busy} onClick={merge}><Icon name="git-merge" small /> Merge</button>
          <select value={method} onChange={(e) => setMethod(e.target.value)} title="Merge method">
            <option value="squash">Squash</option>
            <option value="merge">Merge commit</option>
            <option value="rebase">Rebase</option>
          </select>
        </span>
        <button disabled={busy} title={`Check out ${pr.branch} in this folder`} onClick={() => act('checkout', 'checkout', {})}><Icon name="git-branch" small /> Checkout</button>
        <button className="btn sm gh-claude" title="Send a review prompt to the chat" onClick={askReview}><Icon name="sparkle" small /> Ask Claude to review</button>
      </div>
    </div>
  );
}

function Detail({ pr, onBack }: { pr: PullRequest; onBack: () => void }) {
  const cwd = useStore((s) => s.session.cwd);
  const [d, setD] = useState<PullRequestDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const diffs = useMemo(() => splitDiff(d?.diff ?? ''), [d?.diff]);

  const fetchDetail = () => call<PullRequestDetail>(`/api/gh/pr/${pr.number}`).then(setD, (e) => setError(message(e)));
  useEffect(() => void fetchDetail(), []);

  const act: Act = async (label, path, body) => {
    setBusy(label);
    setError('');
    try {
      await call(`/api/gh/pr/${pr.number}/${path}`, body);
      await Promise.all([fetchDetail(), load(cwd, true)]);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy('');
    }
  };

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
          <div className="gh-line">
            <Avatar login={pr.author} />
            <span className="gh-author">{pr.author}</span>
            {pr.draft && <span className="chip outline pill sm">Draft</span>}
            <StateChip state={pr.review} />
            <Counts a={pr.additions} d={pr.deletions} />
          </div>
          <div className="gh-line"><Icon name="git-branch" small /><span className="gh-branch">{pr.branch}</span><span className="gh-when">{ago(pr.updatedAt)}</span></div>
        </div>
        {busy && <div className="muted small gh-pad" role="status"><Icon name="loading" small spin /> Running {busy.replace('_', ' ')}…</div>}
        {error && <div className="gh-error" role="alert"><Icon name="error" small /> {error}</div>}

        {!d ? (
          !error && <div className="gh-pad"><Skeleton /></div>
        ) : (
          <>
            <Findings target={String(pr.number)} />
            <Block title="Description">
              <div className="gh-pad">{d.body.trim() ? <Markdown text={d.body} /> : <span className="muted">No description</span>}</div>
            </Block>
            <Block title="Checks" count={d.checks.length}>
              {d.checks.map((c, i) => (
                <a key={i} className="gh-item" href={c.url || undefined} target="_blank" rel="noreferrer">
                  <CheckIcon state={c.state} />
                  <span className="gh-msg">{c.name}</span>
                  {c.url && <Icon name="link-external" small />}
                </a>
              ))}
            </Block>
            <Block title="Reviews" count={d.reviews.length}>
              {d.reviews.map((r, i) => <Review key={i} r={r} />)}
            </Block>
            <Block title="Commits" count={d.commits.length}>
              {d.commits.map((c) => (
                <div key={c.oid} className="gh-item"><span className="gh-sha">{c.oid.slice(0, 7)}</span><span className="gh-msg">{c.message}</span></div>
              ))}
            </Block>
            <Block title="Files changed" count={d.files.length}>
              <Files files={d.files} diffs={diffs} />
            </Block>
          </>
        )}
      </div>
      <ActionBar pr={pr} busy={!!busy} act={act} confirm={setAsk} />
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
