import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GitFile, GitStatus } from '../../../shared/protocol';
import { api, setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { FileIcon } from './Explorer';
import { Findings, REVIEW_LOCAL } from './Findings';
import { askClaude, pressable, usePoll } from './util';

let git: { status: GitStatus | null; error: string } = { status: null, error: '' };
const subs = new Set<() => void>();
const subscribe = (l: () => void) => (subs.add(l), () => void subs.delete(l));
const useGit = () => useSyncExternalStore(subscribe, () => git);

async function refresh() {
  try {
    const r = await fetch(api('/api/git/status'));
    const d = await r.json();
    git = r.ok ? { status: d, error: '' } : { status: null, error: d.error };
  } catch {
    return;
  }
  subs.forEach((l) => l());
}

export function ChangesBadge() {
  const n = useGit().status?.files.length ?? 0;
  const id = useStore((s) => s.session.id);
  const recent = useStore((s) => s.recentFiles);
  useEffect(() => void refresh(), [id, recent]);
  return n > 0 ? <span className="badge">{n}</span> : null;
}

type Run = (action: string, body: object) => Promise<boolean>;
const paths = (list: GitFile[]) => ({ paths: list.map((f) => f.path) });
const letterOf = (f: GitFile) => (f.status === '?' ? 'U' : f.status);
const STATUS: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', U: 'Untracked' };
const DRAFT_PROMPT = 'Propose a commit subject for the staged changes in this repo. Read them with `git diff --cached`. Reply with one imperative subject line under 50 characters, no trailing period, no body and nothing else.';

function Action({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button className="icon-btn" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <Icon name={icon} small />
    </button>
  );
}

function BranchBar({ status, onRefresh }: { status: GitStatus | null; onRefresh: () => void }) {
  return (
    <div className="scm-branch">
      <Icon name="git-branch" small />
      <span className="scm-branch-name">{status?.branch || 'No branch'}</span>
      {status && status.behind > 0 && <span className="scm-ab" title={`${status.behind} behind`}>{status.behind}<Icon name="arrow-down" small /></span>}
      {status && status.ahead > 0 && <span className="scm-ab" title={`${status.ahead} ahead`}>{status.ahead}<Icon name="arrow-up" small /></span>}
      <span className="spacer" />
      <Action icon="refresh" title="Refresh" onClick={onRefresh} />
    </div>
  );
}

function CommitBox({ branch, staged, onCommit }: { branch: string; staged: number; onCommit: (message: string) => Promise<boolean> }) {
  const [message, setMessage] = useState('');
  const canCommit = staged > 0 && message.trim() !== '';
  const commit = async () => canCommit && (await onCommit(message)) && setMessage('');
  return (
    <div className="scm-commit">
      <textarea
        value={message}
        rows={Math.min(6, message.split('\n').length)}
        placeholder={`Message (⌘Enter to commit${branch ? ` on ${branch}` : ''})`}
        spellCheck={false}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); } }}
      />
      <div className="scm-commit-actions">
        <button className="primary" disabled={!canCommit} title={staged ? 'Commit the staged changes' : 'Stage changes to commit them'} onClick={() => void commit()}>
          <Icon name="check" small /> Commit
        </button>
        <button className="scm-claude" disabled={staged === 0} title={staged ? 'Ask Claude in the chat for a commit subject' : 'Stage changes first'} onClick={() => askClaude(DRAFT_PROMPT)}>
          <Icon name="sparkle" small /> Write message with Claude
        </button>
      </div>
    </div>
  );
}

function FileRow({ file, selected, actions }: { file: GitFile; selected: boolean; actions: ReactNode }) {
  const name = file.path.split('/').pop()!;
  const dir = file.path.slice(0, -name.length - 1);
  const letter = letterOf(file);
  return (
    <div className={`scm-row s-${letter}${selected ? ' selected' : ''}`} title={file.path} {...pressable(() => setUi({ openFile: file.path, follow: false }))}>
      <FileIcon name={name} />
      <span className="scm-name">{name}</span>
      {dir && <span className="scm-dir">{dir}</span>}
      <span className="scm-acts">{actions}</span>
      <span className="scm-letter" title={STATUS[letter]}>{letter}</span>
    </div>
  );
}

function Section({ label, files, selected, actions, rowActions }: { label: string; files: GitFile[]; selected: string | null; actions: ReactNode; rowActions: (f: GitFile) => ReactNode }) {
  const [open, setOpen] = useState(true);
  if (!files.length) return null;
  return (
    <>
      <div className="scm-header" {...pressable(() => setOpen(!open))}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span className="scm-label">{label}</span>
        <span className="scm-acts">{actions}</span>
        <span className="scm-count">{files.length}</span>
      </div>
      {open && files.map((f) => <FileRow key={f.path} file={f} selected={selected === f.path} actions={rowActions(f)} />)}
    </>
  );
}

export function Changes() {
  const { status, error } = useGit();
  const openFile = useStore((s) => s.ui.openFile);
  const id = useStore((s) => s.session.id);
  const [failed, setFailed] = useState('');
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => void refresh(), [id]);
  usePoll(root, 5000, refresh, [id]);

  const run: Run = async (action, body) => {
    setFailed('');
    try {
      const r = await fetch(api(`/api/git/${action}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) setFailed((await r.json()).error);
      return r.ok;
    } catch (err) {
      setFailed(String(err));
      return false;
    } finally {
      void refresh();
    }
  };

  const files = status?.files ?? [];
  const staged = files.filter((f) => f.staged);
  const changes = files.filter((f) => !f.staged);
  const open = (f: GitFile) => setUi({ openFile: f.path, follow: false });

  const discard = (list: GitFile[]) => {
    const removes = list.some((f) => f.status === '?');
    setAsk({
      title: list.length === 1 ? `Discard changes in ${list[0].path}?` : `Discard changes in ${list.length} files?`,
      detail: removes ? 'Untracked files are deleted, other files go back to their last staged or committed version.' : 'The files go back to their last staged or committed version.',
      warning: 'This cannot be undone.',
      action: removes ? 'Discard and Delete' : 'Discard',
      run: () => run('discard', paths(list)),
    });
  };

  return (
    <div className="scm" ref={root}>
      <BranchBar status={status} onRefresh={() => void refresh()} />
      <CommitBox branch={status?.branch ?? ''} staged={staged.length} onCommit={(message) => run('commit', { message })} />
      <div className="scm-commit-actions scm-review">
        <button className="scm-claude" disabled={!files.length} title={files.length ? 'Claude reviews the working tree, findings show below' : 'No changes to review'} onClick={() => askClaude(REVIEW_LOCAL)}>
          <Icon name="search" small /> Review changes with Claude
        </button>
      </div>
      {(failed || error) && <div className="scm-error">{failed || error}</div>}
      <div className="scm-tree">
        <Section
          label="Staged Changes"
          files={staged}
          selected={openFile}
          actions={<Action icon="remove" title="Unstage All Changes" onClick={() => run('unstage', paths(staged))} />}
          rowActions={(f) => (
            <>
              <Action icon="go-to-file" title="Open File" onClick={() => open(f)} />
              <Action icon="remove" title="Unstage Changes" onClick={() => run('unstage', paths([f]))} />
            </>
          )}
        />
        <Section
          label="Changes"
          files={changes}
          selected={openFile}
          actions={
            <>
              <Action icon="discard" title="Discard All Changes" onClick={() => discard(changes)} />
              <Action icon="add" title="Stage All Changes" onClick={() => run('stage', paths(changes))} />
            </>
          }
          rowActions={(f) => (
            <>
              <Action icon="go-to-file" title="Open File" onClick={() => open(f)} />
              <Action icon="discard" title="Discard Changes" onClick={() => discard([f])} />
              <Action icon="add" title="Stage Changes" onClick={() => run('stage', paths([f]))} />
            </>
          )}
        />
        {status && !files.length && <div className="scm-empty">No changes</div>}
        <Findings target="local" />
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
