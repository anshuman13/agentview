import { useEffect, useMemo, useState } from 'react';
import { deleteRequest } from './sessionApi';
import { send, setUi, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import type { SavedSession, Worktree } from '../../../shared/protocol';
import { inside } from '../../../shared/util';
import { pressable, save, stored } from '../ui/util';
import { chatFinder, deleteChat, findHere, flip, groupByKind, invalidateWorkspace, segmentOf, usePins, useWorkspace, worktreeRequest, type Folder } from './folders';
import { FilterInput } from './FilterInput';
import { RepoRow, SessionRow, WorktreeRow } from './RepoRow';
import { WaitingRows } from './ChatRows';
import { NeedsYou } from './NeedsYou';

const PAGE = 5;

export function Sessions() {
  const current = useStore((s) => s.session.sessionId);
  const cwd = useStore((s) => s.session.cwd);
  const lastSystem = useStore((s) => { const e = s.events[s.events.length - 1]; return e?.kind === 'system' ? e.id : null; });
  const { folders, chats, setTrees, setChats } = useWorkspace(current + cwd);
  const { pins, setPin } = usePins();
  const liveKey = useStore((s) => s.live.map((c) => c.cwd).join('\n'));
  const waitingCount = useStore((s) => s.live.reduce((n, c) => n + (c.pending ? 1 : 0), 0));
  const [filter, setFilter] = useState('');
  const viewing = useStore((s) => s.session.id);
  const [segment, setSegment] = useState(() => stored('agentview.workspace.segment', 'work'));
  const [shut, setShut] = useState<string[]>(() => stored('agentview.workspace.kinds', []));
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [full, setFull] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ repo: string; branch: string } | null>(null);

  useEffect(() => {
    if (lastSystem) setOpening(null);
  }, [lastSystem]);

  useEffect(() => setOpening(null), [current, cwd]);

  const here = findHere(folders, cwd).folder?.cwd;

  const shown = useMemo(() => {
    const find = chatFinder(filter, chats);
    if (!find.active) return folders;
    return folders.flatMap((d): Folder[] => {
      if (find.match(d.name, undefined, d.repo?.branch)) return [d];
      const kept = d.chats.filter((s) => find.match(s.title, s.sessionId, d.name, s.gitBranch));
      const trees = d.trees.filter((w) => find.match(w.name, undefined));
      return kept.length || trees.length ? [{ ...d, chats: kept, trees, hit: true }] : [];
    });
  }, [folders, chats, filter]);

  const open = (id: string) => {
    if (id === current) return;
    setOpening(id);
    send({ type: 'open_session', sessionId: id });
  };

  const start = (dir: string) => {
    setError(null);
    invalidateWorkspace();
    send({ type: 'new_session', cwd: dir });
  };

  const call = async (url: string, fallback: string) => {
    const r = await deleteRequest(url);
    if (!r?.ok) setError((await r?.json().catch(() => null))?.error ?? fallback);
    return !!r?.ok;
  };

  const remove = (s: SavedSession) => setAsk(deleteChat(s, () => setChats((l) => l.filter((x) => x.sessionId !== s.sessionId)), setError));

  const removeTree = (w: Worktree) =>
    setAsk({
      title: `Remove this ${w.project} worktree?`,
      detail: w.name,
      warning: `${w.dirty ? `${w.dirty} uncommitted ${w.dirty === 1 ? 'change' : 'changes'} will be lost. ` : ''}The folder is deleted, the branch is kept.`,
      action: 'Remove',
      run: async () => {
        flip(setRemoving, w.id);
        if (await call(`/api/worktrees?id=${encodeURIComponent(w.id)}`, 'Could not remove the worktree')) setTrees((t) => t.filter((x) => x.id !== w.id));
        flip(setRemoving, w.id);
      },
    });

  const newTree = (d: Folder) =>
    setAsk(worktreeRequest(d, (branch, err) => {
      setError(err ?? null);
      setCreating(branch ? { repo: d.cwd, branch } : null);
    }));

  const liveCwds = useMemo(() => (liveKey ? liveKey.split('\n') : []), [liveKey]);
  const counts = { work: shown.filter((f) => segmentOf(f) === 'work').length, personal: shown.filter((f) => segmentOf(f) === 'personal').length };
  const groups = useMemo(() => groupByKind(shown.filter((f) => segmentOf(f) === segment), liveCwds), [shown, segment, liveCwds]);
  const pick = (v: string) => { setSegment(v); save('agentview.workspace.segment', v); };
  const flipKind = (k: string) => { const next = shut.includes(k) ? shut.filter((x) => x !== k) : [...shut, k]; setShut(next); save('agentview.workspace.kinds', next); };
  const isOpen = (d: Folder) => Boolean(d.hit) || (d.cwd === here || liveCwds.some((c) => inside(c, d.cwd))) !== toggled.has(d.cwd);

  const folderRows = (d: Folder, active: boolean, icon: string) => {
    return (
      <div key={d.cwd}>
        <RepoRow d={d} active={active} here={d.cwd === here} open={isOpen(d)} icon={icon} creating={Boolean(creating)} toggle={() => flip(setToggled, d.cwd)} newTree={() => newTree(d)} start={() => start(d.cwd)} />
        {creating?.repo === d.cwd && (
          <div className="row session worktree removing" title={creating.branch}>
            <Icon name="git-branch" small />
            <span className="name">Creating {creating.branch}…</span>
            <span className="busy"><Icon name="loading" small spin /></span>
          </div>
        )}
        {isOpen(d) && d.trees.map((w) => <WorktreeRow key={w.id} w={w} removing={removing.has(w.id)} start={() => start(w.cwd)} remove={() => { setError(null); removeTree(w); }} />)}
        {isOpen(d) && (full.has(d.cwd) || filter ? d.chats : d.chats.slice(0, PAGE)).map((c) => <SessionRow key={c.sessionId} s={c} selected={c.sessionId === current} opening={opening === c.sessionId} open={() => open(c.sessionId)} remove={() => { setError(null); remove(c); }} />)}
        {isOpen(d) && !filter && d.chats.length > PAGE && (
          <div className="row more" {...pressable(() => flip(setFull, d.cwd))}>
            {full.has(d.cwd) ? 'Show less' : `Show ${d.chats.length - PAGE} more`}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sessions workspace">
      <div className="sessions-bar">
        <FilterInput value={filter} set={setFilter} />
        <button className="icon-btn" title="Start a chat in a folder or new project (⌘O)" onClick={() => setUi({ repoPicker: true })}><Icon name="folder-opened" /></button>
        <button className="icon-btn" title="New chat in this folder" onClick={() => start(cwd)}><Icon name="add" /></button>
      </div>
      {error && <div className="hint error" onClick={() => setError(null)}><Icon name="error" small /> {error}</div>}
      <NeedsYou n={waitingCount}>
        <WaitingRows viewing={viewing} ask={setAsk} pins={pins} setPin={setPin} setChats={setChats} />
      </NeedsYou>
      <div className="side-switch">
        {(['work', 'personal'] as const).map((k) => (
          <button key={k} className={segment === k ? 'active' : ''} onClick={() => pick(k)}>{k === 'work' ? 'Work' : 'Personal'} <span className="seg-count">{counts[k]}</span></button>
        ))}
      </div>
      <div className="tree">
        {groups.map((g) => (
          <div key={g.kind}>
            <div className="row group-row" {...pressable(() => flipKind(g.kind))}>
              <span className="twistie"><Icon name={filter || !shut.includes(g.kind) ? 'chevron-down' : 'chevron-right'} small /></span>
              <span className="name">{g.label}</span>
              <span className="count">{g.items.length}</span>
            </div>
            {(filter || !shut.includes(g.kind)) && g.items.map(({ f, active }) => folderRows(f, active, g.icon))}
          </div>
        ))}
        {!groups.length && <EmptyState size="sm" title={filter ? 'No repo or chat matches' : 'No repos here'} />}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
