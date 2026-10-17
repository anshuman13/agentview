import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GitFile, GitStatus } from '../../../shared/protocol';
import { api, setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { Confirm, type ConfirmRequest } from '../Confirm';
import './changes.css';

let git: { status: GitStatus | null; error: string } = { status: null, error: '' };
const subs = new Set<() => void>();
const useGit = () => useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => git);

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

export function Changes() {
  const { status, error } = useGit();
  const openFile = useStore((s) => s.ui.openFile);
  const id = useStore((s) => s.session.id);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => !document.hidden && root.current?.offsetParent && void refresh(), 5000);
    return () => clearInterval(t);
  }, [id]);

  const run = async (action: string, body: object) => {
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
  const paths = (list: GitFile[]) => ({ paths: list.map((f) => f.path) });
  const canCommit = staged.length > 0 && message.trim() !== '';
  const commit = async () => canCommit && (await run('commit', { message })) && setMessage('');

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

  const btn = (icon: string, title: string, fn: () => void) => (
    <button className="icon-btn" title={title} onClick={(e) => { e.stopPropagation(); fn(); }}><Icon name={icon} small /></button>
  );

  const row = (f: GitFile) => {
    const name = f.path.split('/').pop()!;
    const letter = f.status === '?' ? 'U' : f.status;
    return (
      <div key={`${f.staged}:${f.path}`} className={`row file s-${letter} ${openFile === f.path ? 'selected' : ''}`} title={f.path} onClick={() => setUi({ openFile: f.path, follow: false })}>
        <Icon name="file" small />
        <span className="name">{name}</span>
        <span className="dir">{f.path.slice(0, -name.length - 1)}</span>
        <span className="acts">
          {f.staged ? btn('remove', 'Unstage Changes', () => run('unstage', paths([f]))) : <>
            {btn('discard', 'Discard Changes', () => discard([f]))}
            {btn('add', 'Stage Changes', () => run('stage', paths([f])))}
          </>}
        </span>
        <span className="letter">{letter}</span>
      </div>
    );
  };

  const section = (key: string, label: string, list: GitFile[], acts: React.ReactNode) => list.length > 0 && (
    <>
      <div className="row group" onClick={() => setClosed((c) => ({ ...c, [key]: !c[key] }))}>
        <span className="twistie"><Icon name={closed[key] ? 'chevron-right' : 'chevron-down'} small /></span>
        <span className="name">{label}</span>
        <span className="acts">{acts}</span>
        <span className="count">{list.length}</span>
      </div>
      {!closed[key] && list.map(row)}
    </>
  );

  return (
    <div className="changes" ref={root}>
      <div className="commit">
        <textarea
          value={message}
          rows={Math.min(6, message.split('\n').length)}
          placeholder={`Message (⌘Enter to commit${status?.branch ? ` on "${status.branch}"` : ''})`}
          spellCheck={false}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); } }}
        />
        <button className="primary" disabled={!canCommit} title={staged.length ? 'Commit the staged changes' : 'Stage changes to commit them'} onClick={() => void commit()}>
          <Icon name="check" small /> Commit
        </button>
        {status && (
          <div className="branch">
            <Icon name="git-branch" small /> {status.branch}
            {status.behind > 0 && <span>{status.behind}<Icon name="arrow-down" small /></span>}
            {status.ahead > 0 && <span>{status.ahead}<Icon name="arrow-up" small /></span>}
          </div>
        )}
        {(failed || error) && <div className="error">{failed || error}</div>}
      </div>
      <div className="tree">
        {section('staged', 'Staged', staged, btn('remove', 'Unstage All Changes', () => run('unstage', paths(staged))))}
        {section('changes', 'Changes', changes, <>
          {btn('discard', 'Discard All Changes', () => discard(changes))}
          {btn('add', 'Stage All Changes', () => run('stage', paths(changes)))}
        </>)}
        {status && !files.length && <div className="empty muted small">No changes.</div>}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
