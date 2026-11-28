import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { GitFile, GitStatus } from '../../../shared/protocol';
import { errText } from '../../../shared/util';
import { setUi, useStore } from '../app/store';
import { fetchBranchDiff, fetchBranches, fetchCommitDiff, postGit, type BranchDiff, type DiffFiles } from './fileApi';
import { Row } from '../ui/Row';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Files, splitDiff } from '../ui/DiffFiles';
import { Section as ListSection } from '../ui/Section';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { FileIcon } from './FileIcon';
import { refresh, useGit } from './gitStatus';
import { Findings, REVIEW_LOCAL } from '../ops/Findings';
import { ago, clickOnKey, save, showChat, stored, usePoll } from '../ui/util';
import { QuickPick } from '../ui/QuickPick';
import { askChat, insertText } from '../chat/chatActions';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { CopyPathItems } from './CopyPathItems';
import { mentionOf } from './copyPathLogic';
import { providerLabel } from '../../../shared/providers';
import '../styles/features/changes.css';

type Run = (action: string, body: object) => Promise<boolean>;
const paths = (list: GitFile[]) => ({ paths: list.map((f) => f.path) });
const letterOf = (f: GitFile) => (f.status === '?' ? 'U' : f.status);
const STATUS: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', U: 'Untracked' };
const DRAFT_PROMPT = 'Propose a commit subject for the staged changes in this repo. Read them with `git diff --cached`. Reply with one imperative subject line under 50 characters, no trailing period, no body and nothing else.';

function Action({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <IconButton icon={icon} small label={title} onClick={(e) => { e.stopPropagation(); onClick(); }} />
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
        <Button variant="primary" icon="check" disabled={!canCommit} title={staged ? 'Commit the staged changes' : 'Stage changes to commit them'} onClick={() => void commit()}>Commit</Button>
        <Button variant="quiet" icon="sparkle" className="scm-claude" disabled={staged === 0} title={staged ? 'Ask the agent in the chat for a commit subject' : 'Stage changes first'} onClick={() => askChat(DRAFT_PROMPT)}>Write message with {label}</Button>
      </div>
    </div>
  );
}

// The row's ⋯ menu, like Claude.app's per-file menu in its diff pane.
function RowMenu({ file, cwd, onOpen }: { file: GitFile; cwd: string; onOpen: () => void }) {
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const attach = () => {
    close();
    showChat();
    insertText(`${mentionOf(file.path, cwd)} `);
  };
  return (
    <>
      <IconButton ref={more} icon="kebab-vertical" small label="More Actions" aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} />
      {open && (
        <Menu trigger={more} onClose={close}>
          <MenuItem icon="mention" onClick={attach}>Attach as context</MenuItem>
          <MenuItem icon="go-to-file" onClick={() => { close(); onOpen(); }}>Open file</MenuItem>
          <MenuSeparator />
          <CopyPathItems path={file.path} cwd={cwd} onDone={close} />
        </Menu>
      )}
    </>
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

// The branch each folder's Changes pane compares against, when not the default branch.
const BASES_KEY = 'agentview.compareBase';
const savedBase = (cwd: string): string | undefined => stored<Record<string, string>>(BASES_KEY, {})[cwd];
function saveBase(cwd: string, base: string | null) {
  const all = stored<Record<string, string>>(BASES_KEY, {});
  if (base) all[cwd] = base; else delete all[cwd];
  save(BASES_KEY, all);
}

// "Committed since <base>" opens a list of local and remote branches; the default branch clears the choice.
function BasePick({ base, onPick }: { base: string; onPick: (base: string | null) => void }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const [list, setList] = useState<{ branches: string[]; base: string } | null>(null);
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    setAt(e.currentTarget.getBoundingClientRect());
    fetchBranches().then(setList, () => setList({ branches: [], base }));
  };
  return (
    <>
      <button type="button" className="scm-base" aria-haspopup="dialog" title="Compare against another branch" onClick={open}>
        Committed since {base}<Icon name="chevron-down" small />
      </button>
      {at && list && (
        <QuickPick
          anchor={at}
          title="Compare against"
          items={list.branches.map((b) => ({ value: b, label: b, detail: b === list.base ? 'default' : undefined }))}
          current={base}
          onPick={(b) => { setAt(null); onPick(b === list.base ? null : b); }}
          onClose={() => setAt(null)}
        />
      )}
    </>
  );
}

const patches = (d: DiffFiles) => (d.diff ? splitDiff(d.diff) : new Map(d.files.map((f) => [f.path, 'Diff too large to show'])));

// What the branch committed since it left the default branch, on the default branch itself what it has not pushed; rows expand to their patch.
// With more than one commit, a list above the files picks "All changes" or one commit, whose files are loaded on their own.
function Committed({ branch, current, onBase }: { branch: BranchDiff; current?: string; onBase: (base: string | null) => void }) {
  const commits = branch.commits ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const [one, setOne] = useState<{ hash: string; data: DiffFiles | null; error?: string } | null>(null);
  useEffect(() => {
    if (pick && !commits.some((c) => c.hash === pick)) setPick(null);
  }, [branch]);
  useEffect(() => {
    if (!pick) return setOne(null);
    let live = true;
    setOne({ hash: pick, data: null });
    fetchCommitDiff(pick).then((data) => live && setOne({ hash: pick, data }), (err) => live && setOne({ hash: pick, data: null, error: errText(err) }));
    return () => { live = false; };
  }, [pick]);
  const shown = pick ? (one?.data ?? null) : branch;
  const diffs = useMemo(() => (shown ? patches(shown) : new Map<string, string>()), [shown]);
  return (
    <>
      <ListSection label={current === branch.base ? 'Not pushed' : <BasePick base={branch.base} onPick={onBase} />} count={branch.files.length} />
      {commits.length > 1 && (
        <div className="as-group scm-commits" aria-label="Commits">
          <Row title="All changes" lines={1} aria-current={!pick} trailing={<span className="muted">{commits.length} commits</span>} onClick={() => setPick(null)} />
          {commits.map((c) => (
            <Row key={c.hash} title={c.subject} lines={1} aria-current={pick === c.hash} trailing={<span className="muted scm-sha">{c.hash} · {ago(c.at)}</span>} onClick={() => setPick(pick === c.hash ? null : c.hash)} />
          ))}
        </div>
      )}
      <div className="as-group gh-group">
        {shown ? <Files key={pick ?? ''} files={shown.files} diffs={diffs} /> : one?.error ? <div className="scm-error" role="alert">{one.error}</div> : <div className="muted scm-loading">Loading…</div>}
      </div>
    </>
  );
}

const NOT_GIT = /not a git repository/i;

export function Changes() {
  const { status, error } = useGit();
  const openFile = useStore((s) => s.ui.openFile);
  const id = useStore((s) => s.session.id);
  const cwd = useStore((s) => s.session.cwd);
  const [base, setBase] = useState(() => savedBase(cwd));
  const label = useStore((s) => providerLabel(s.session.provider));
  const [failed, setFailed] = useState('');
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [branch, setBranch] = useState<BranchDiff | null>(null);
  const branchSeq = useRef(0);
  // A reply that lands after a newer request is dropped; a failed load keeps the diff shown.
  const reload = () => {
    void refresh();
    const n = ++branchSeq.current;
    fetchBranchDiff(base).then((b) => n === branchSeq.current && setBranch(b), () => {});
  };

  useEffect(() => setBase(savedBase(cwd)), [cwd]);
  useEffect(() => {
    setBranch(null);
    reload();
  }, [id, base]);
  const pickBase = (b: string | null) => {
    saveBase(cwd, b);
    setBase(b ?? undefined);
  };
  // ChangesBadge refreshes after each file change; this catches git commands run outside.
  usePoll(root, 30_000, () => void refresh(), [id]);

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
      reload();
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
      <BranchBar status={status} onRefresh={reload} />
      {files.length > 0 && (
        <>
          <CommitBox branch={status?.branch ?? ''} staged={staged.length} onCommit={(message) => run('commit', { message })} />
          <div className="scm-commit-actions scm-review">
            <Button variant="quiet" icon="search" className="scm-claude" title={`${label} reviews the working tree, findings show below`} onClick={() => askChat(REVIEW_LOCAL)}>Review changes with {label}</Button>
          </div>
        </>
      )}
      {(failed || error) && (NOT_GIT.test(failed || error)
        ? <div className="scm-error muted">This folder is not a git repository.</div>
        : <div className="scm-error" role="alert">{failed || error}</div>)}
      <div className="scm-tree">
        <Section
          label="Staged changes"
          files={staged}
          isSelected={isSelected}
          onRowClick={clickRow(staged)}
          actions={<Action icon="remove" title="Unstage All Changes" onClick={() => run('unstage', paths(staged))} />}
          rowActions={(f) => (
            <>
              <Action icon="go-to-file" title="Open File" onClick={() => open(f)} />
              <Action icon="remove" title="Unstage Changes" onClick={() => run('unstage', paths(targets(f, staged)))} />
              <RowMenu file={f} cwd={cwd} onOpen={() => open(f)} />
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
              <RowMenu file={f} cwd={cwd} onOpen={() => open(f)} />
            </>
          )}
        />
        {status && !files.length && <EmptyState size="sm" title="No changes" />}
        {branch && (branch.files.length > 0 || base) && <Committed branch={branch} current={status?.branch} onBase={pickBase} />}
        <Findings target="local" />
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
