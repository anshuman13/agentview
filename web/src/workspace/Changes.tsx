import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { GitFile, GitStatus } from '../../../shared/protocol';
import { errText } from '../../../shared/util';
import { setUi, useStore } from '../app/store';
import { postGit } from './fileApi';
import { Icon } from '../ui/Icon';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { FileIcon } from './FileIcon';
import { refresh, useGit } from './gitStatus';
import { Findings, REVIEW_LOCAL } from '../ops/Findings';
import { clickOnKey, usePoll } from '../ui/util';
import { askChat } from '../chat/chatActions';
import { providerLabel } from '../../../shared/providers';
import '../styles/features/changes.css';

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
  const label = useStore((s) => providerLabel(s.session.provider));
  const canCommit = staged > 0 && message.trim() !== '';
  const commit = async () => canCommit && (await onCommit(message)) && setMessage('');
  return (
    <div className="scm-commit">
      <textarea
        value={message}
        rows={Math.min(6, message.split('\n').length)}
        aria-label="Commit message"
        placeholder={`Message (⌘Enter to commit${branch ? ` on ${branch}` : ''})`}
        spellCheck={false}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); } }}
      />
      <div className="scm-commit-actions">
        <button className="btn primary" disabled={!canCommit} title={staged ? 'Commit the staged changes' : 'Stage changes to commit them'} onClick={() => void commit()}>
          <Icon name="check" small /> Commit
        </button>
        <button className="btn quiet scm-claude" disabled={staged === 0} title={staged ? 'Ask the agent in the chat for a commit subject' : 'Stage changes first'} onClick={() => askChat(DRAFT_PROMPT)}>
          <Icon name="sparkle" small /> Write message with {label}
        </button>
      </div>
    </div>
  );
}

type RowClick = (f: GitFile, e: MouseEvent) => void;

function FileRow({ file, selected, actions, onClick }: { file: GitFile; selected: boolean; actions: ReactNode; onClick: RowClick }) {
  const name = file.path.split('/').pop()!;
  const dir = file.path.slice(0, -name.length - 1);
  const letter = letterOf(file);
  return (
    <div className={`scm-row s-${letter}${selected ? ' selected' : ''}`} title={file.path} onMouseDown={(e) => (e.shiftKey || e.metaKey || e.ctrlKey) && e.preventDefault()} onClick={(e) => onClick(file, e)}>
      <FileIcon name={name} />
      <span className="scm-name" role="button" tabIndex={0} aria-label={`${file.path}, ${STATUS[letter] ?? letter}`} onKeyDown={clickOnKey}>{name}</span>
      {dir && <span className="scm-dir">{dir}</span>}
      <span className="scm-acts">{actions}</span>
      <span className="scm-letter" title={STATUS[letter]}>{letter}</span>
    </div>
  );
}

function Section({ label, files, isSelected, actions, rowActions, onRowClick }: { label: string; files: GitFile[]; isSelected: (f: GitFile) => boolean; actions: ReactNode; rowActions: (f: GitFile) => ReactNode; onRowClick: RowClick }) {
  const [open, setOpen] = useState(true);
  if (!files.length) return null;
  return (
    <>
      <div className="section-head" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span className="label" role="button" tabIndex={0} aria-expanded={open} onKeyDown={clickOnKey}>{label}</span>
        <span className="scm-acts">{actions}</span>
        <span className="badge quiet">{files.length}</span>
      </div>
      {open && files.map((f) => <FileRow key={f.path} file={f} selected={isSelected(f)} actions={rowActions(f)} onClick={onRowClick} />)}
    </>
  );
}

const NOT_GIT = /not a git repository/i;

export function Changes() {
  const { status, error } = useGit();
  const openFile = useStore((s) => s.ui.openFile);
  const id = useStore((s) => s.session.id);
  const label = useStore((s) => providerLabel(s.session.provider));
  const [failed, setFailed] = useState('');
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);

  useEffect(() => void refresh(), [id]);
  // ChangesBadge refreshes after each file change; this catches git commands run outside.
  usePoll(root, 30_000, refresh, [id]);

  const run: Run = async (action, body) => {
    setFailed('');
    try {
      await postGit(action, body);
      return true;
    } catch (err) {
      setFailed(errText(err));
      return false;
    } finally {
      setPicked(new Set());
      void refresh();
    }
  };

  const files = status?.files ?? [];
  const staged = files.filter((f) => f.staged);
  const changes = files.filter((f) => !f.staged);
  const open = (f: GitFile) => setUi({ openFile: f.path, follow: false });
  const keyOf = (f: GitFile) => `${f.staged ? 's' : 'w'}:${f.path}`;
  const isSelected = (f: GitFile) => (picked.size ? picked.has(keyOf(f)) : f.path === openFile);
  const targets = (f: GitFile, list: GitFile[]) => (picked.has(keyOf(f)) ? list.filter((g) => picked.has(keyOf(g))) : [f]);

  const clickRow = (list: GitFile[]) => (f: GitFile, e: MouseEvent) => {
    const key = keyOf(f);
    if (e.shiftKey && anchor.current && list.some((g) => keyOf(g) === anchor.current)) {
      const a = list.findIndex((g) => keyOf(g) === anchor.current);
      const b = list.indexOf(f);
      setPicked(new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1).map(keyOf)));
      return;
    }
    anchor.current = key;
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(picked.size ? picked : list.filter((g) => g.path === openFile).map(keyOf));
      if (next.has(key)) next.delete(key); else next.add(key);
      setPicked(next);
      return;
    }
    setPicked(new Set());
    open(f);
  };

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
    <div className="scm" ref={root} onKeyDown={(e) => e.key === 'Escape' && picked.size > 0 && setPicked(new Set())}>
      <BranchBar status={status} onRefresh={() => void refresh()} />
      {files.length > 0 && (
        <>
          <CommitBox branch={status?.branch ?? ''} staged={staged.length} onCommit={(message) => run('commit', { message })} />
          <div className="scm-commit-actions scm-review">
            <button className="btn quiet scm-claude" title={`${label} reviews the working tree, findings show below`} onClick={() => askChat(REVIEW_LOCAL)}>
              <Icon name="search" small /> Review changes with {label}
            </button>
          </div>
        </>
      )}
      {(failed || error) && (NOT_GIT.test(failed || error)
        ? <div className="scm-error muted">This folder is not a git repository.</div>
        : <div className="scm-error" role="alert">{failed || error}</div>)}
      <div className="scm-tree">
        <Section
          label="Staged Changes"
          files={staged}
          isSelected={isSelected}
          onRowClick={clickRow(staged)}
          actions={<Action icon="remove" title="Unstage All Changes" onClick={() => run('unstage', paths(staged))} />}
          rowActions={(f) => (
            <>
              <Action icon="go-to-file" title="Open File" onClick={() => open(f)} />
              <Action icon="remove" title="Unstage Changes" onClick={() => run('unstage', paths(targets(f, staged)))} />
            </>
          )}
        />
        <Section
          label="Changes"
          files={changes}
          isSelected={isSelected}
          onRowClick={clickRow(changes)}
          actions={
            <>
              <Action icon="discard" title="Discard All Changes" onClick={() => discard(changes)} />
              <Action icon="add" title="Stage All Changes" onClick={() => run('stage', paths(changes))} />
            </>
          }
          rowActions={(f) => (
            <>
              <Action icon="go-to-file" title="Open File" onClick={() => open(f)} />
              <Action icon="discard" title="Discard Changes" onClick={() => discard(targets(f, changes))} />
              <Action icon="add" title="Stage Changes" onClick={() => run('stage', paths(targets(f, changes)))} />
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
