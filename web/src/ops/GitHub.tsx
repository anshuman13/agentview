import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { send, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Findings } from './Findings';
import { Markdown } from '../chat/Chat';
import { FileIcon } from '../workspace/FileIcon';
import { CheckIcon, Counts, StateChip, load, setViewOpen, useList } from './pulls';
import { call } from './opsApi';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import type { PullRequest, PullRequestDetail } from '../../../shared/protocol';
import { errText } from '../../../shared/util';
import { ago, askChat, pressable } from '../ui/util';
import { Skeleton } from '../ui/Skeleton';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { IconButton } from '../ui/Button';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';
import { providerLabel } from '../../../shared/providers';

const initials = (login: string) => (login.replace(/^app\//, '').match(/[A-Za-z0-9]+/g) ?? ['?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const SETUP: Array<{ test: RegExp; icon: string; title: string; text: string; cmd?: string }> = [
  { test: /not installed/i, icon: 'terminal', title: 'GitHub CLI not installed', text: 'Install it, then refresh.', cmd: 'brew install gh' },
  { test: /not logged in/i, icon: 'account', title: 'Not signed in to GitHub', text: 'Sign in with the GitHub CLI, then refresh.', cmd: 'gh auth login' },
  { test: /no GitHub remote/i, icon: 'github', title: 'No GitHub remote', text: 'Open a chat in a folder whose repository lives on GitHub.' },
];

const Avatar = ({ login }: { login: string }) => <span className="gh-avatar" title={login}>{initials(login)}</span>;
function PrRow({ pr, onOpen }: { pr: PullRequest; onOpen: () => void }) {
  const chat = useStore((s) => s.live.find((c) => c.pr === pr.number));
  return (
    <Row
      plain
      data-pr={pr.number}
      {...pressable(onOpen)}
      leading={<CheckIcon state={pr.checks} />}
      title={pr.title}
      meta={`#${pr.number} · ${pr.author} · ${pr.branch} · ${ago(pr.updatedAt)}`}
      trailing={
        <>
          {chat && <IconButton icon="comment" label="Open chat" size="sm" title={`Open the chat that created this pull request: ${chat.title}`} onClick={(e) => { e.stopPropagation(); send({ type: 'view', id: chat.id }); }} />}
          {pr.draft ? <span className="chip outline pill sm">Draft</span> : <StateChip state={pr.review} />}
        </>
      }
    />
  );
}

function PrGroup({ title, empty, prs, onOpen }: { title: string; empty: string; prs: PullRequest[]; onOpen: (p: PullRequest) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <Section label={title} count={prs.length} open={open} onToggle={() => setOpen(!open)} />
      {open && <div className="as-group">{prs.length ? prs.map((p) => <PrRow key={p.number} pr={p} onOpen={() => onOpen(p)} />) : <EmptyState size="sm" title={empty} />}</div>}
    </section>
  );
}

function Problem({ error }: { error: string }) {
  const setup = SETUP.find((s) => s.test.test(error));
  if (!setup) return <div className="gh-error" role="alert"><Icon name="error" small /> {error}</div>;
  return (
    <EmptyState size="md" icon={setup.icon} title={setup.title} hint={<>{setup.text}{setup.cmd && <pre className="gh-cmd">{setup.cmd}</pre>}</>} />
  );
}

function PrList({ onOpen }: { onOpen: (n: number) => void }) {
  const cwd = useStore((s) => s.session.cwd);
  const { prs, error, loading } = useList();
  return (
    <div className="wk"><div className="wk-scroll"><div className="mt-page">
      <Section label="Pull requests" count={loading && !prs.length ? undefined : prs.length} action={<IconButton icon="refresh" label="Refresh" size="sm" spin={loading} disabled={loading} onClick={() => load(cwd, true)} />} />
      {error ? (
        <Problem error={error} />
      ) : (
        <>
          <PrGroup title="Waiting for my review" empty="No pull requests waiting for you" prs={prs.filter((p) => p.reviewRequested)} onOpen={(p) => onOpen(p.number)} />
          <PrGroup title="My pull requests" empty="No pull requests of yours" prs={prs.filter((p) => p.mine)} onOpen={(p) => onOpen(p.number)} />
          <PrGroup title="All open" empty="No open pull requests" prs={prs} onOpen={(p) => onOpen(p.number)} />
        </>
      )}
    </div></div></div>
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
  const root = useRef<HTMLDivElement>(null);
  const back = useRef<number | null>(null);
  useEffect(() => {
    if (open !== null || back.current === null) return;
    root.current?.querySelector<HTMLElement>(`[data-pr="${back.current}"]`)?.focus();
    back.current = null;
  }, [open]);

  return (
    <div className="gh" ref={root}>
      {pr ? <Detail key={pr.number} pr={pr} onBack={() => { back.current = pr.number; setOpen(null); }} /> : <PrList onOpen={setOpen} />}
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
    <>
      <Row plain leading={<Avatar login={r.author} />} title={r.author} meta={ago(r.at)} trailing={<StateChip state={r.state} />} />
      {r.body && <div className="gh-pad"><Markdown text={r.body} /></div>}
    </>
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
          <Fragment key={f.path}>
            <Row
              title={name}
              leading={<FileIcon name={name} />}
              meta={f.path.slice(0, -name.length - 1)}
              trailing={<Counts a={f.additions} d={f.deletions} />}
              aria-expanded={shown}
              onClick={() => setOpen(shown ? null : f.path)}
            />
            {shown && (
              <pre className="gh-diff">{(diffs.get(f.path) ?? 'No diff').split('\n').map((l, i) => <div key={i} className={lineClass(l)}>{l || ' '}</div>)}</pre>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

type Act = (label: string, path: string, body: object) => Promise<boolean>;

function ActionBar({ pr, busy, act, confirm }: { pr: PullRequest; busy: boolean; act: Act; confirm: (c: ConfirmRequest) => void }) {
  const [text, setText] = useState('');
  const label = useStore((s) => providerLabel(s.session.provider));
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
  const askReview = () => askChat(`/code-review ${pr.number}`);

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
        <button className="btn sm gh-claude" title="Send a review prompt to the chat" onClick={askReview}><Icon name="sparkle" small /> Ask {label} to review</button>
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

  const fetchDetail = () => call<PullRequestDetail>(`/api/gh/pr/${pr.number}`).then(setD, (e) => setError(errText(e)));
  useEffect(() => void fetchDetail(), []);

  const act: Act = async (label, path, body) => {
    setBusy(label);
    setError('');
    try {
      await call(`/api/gh/pr/${pr.number}/${path}`, body);
      await Promise.all([fetchDetail(), load(cwd, true)]);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="gh-detail">
      <div className="gh-bar">
        <button className="icon-btn" title="Back" autoFocus onClick={onBack}><Icon name="arrow-left" small /></button>
        <span className="gh-num">#{pr.number}</span>
        <span className="spacer" />
        <a className="icon-btn" href={pr.url} target="_blank" rel="noreferrer" title="Open on GitHub"><Icon name="link-external" small /></a>
      </div>
      <div className="gh-scroll">
        <div className="as-group gh-group">
          <Row
            plain
            lines={2}
            leading={<Avatar login={pr.author} />}
            title={pr.title}
            meta={`${pr.author} · ${pr.branch} · ${ago(pr.updatedAt)}`}
            trailing={<><Counts a={pr.additions} d={pr.deletions} />{pr.draft ? <span className="chip outline pill sm">Draft</span> : <StateChip state={pr.review} />}</>}
          />
        </div>
        {busy && <div className="muted small gh-pad" role="status"><Icon name="loading" small spin /> Running {busy.replace('_', ' ')}…</div>}
        {error && <div className="gh-error" role="alert"><Icon name="error" small /> {error}</div>}

        {!d ? (
          !error && <div className="gh-pad"><Skeleton /></div>
        ) : (
          <>
            <Findings target={String(pr.number)} />
            <Section label="Description" />
            <div className="as-group gh-group">
              <div className="gh-pad">{d.body.trim() ? <Markdown text={d.body} /> : <EmptyState size="sm" title="No description" />}</div>
            </div>
            <Section label="Checks" count={d.checks.length} />
            <div className="as-group gh-group">
              {d.checks.map((c, i) => <Row key={i} href={c.url || undefined} plain={!c.url} leading={<CheckIcon state={c.state} />} title={c.name} />)}
              {!d.checks.length && <EmptyState size="sm" title="No checks" />}
            </div>
            <Section label="Reviews" count={d.reviews.length} />
            <div className="as-group gh-group">
              {d.reviews.map((r, i) => <Review key={i} r={r} />)}
              {!d.reviews.length && <EmptyState size="sm" title="No reviews" />}
            </div>
            <Section label="Commits" count={d.commits.length} />
            <div className="as-group gh-group">
              {d.commits.map((c) => <Row key={c.oid} plain title={c.message} meta={c.oid.slice(0, 7)} />)}
              {!d.commits.length && <EmptyState size="sm" title="No commits" />}
            </div>
            <Section label="Files changed" count={d.files.length} />
            <div className="as-group gh-group">
              <Files files={d.files} diffs={diffs} />
              {!d.files.length && <EmptyState size="sm" title="No files" />}
            </div>
          </>
        )}
      </div>
      <ActionBar pr={pr} busy={!!busy} act={act} confirm={setAsk} />
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
