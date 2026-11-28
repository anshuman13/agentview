import { useEffect, useState, type ReactNode } from 'react';
import { embedded, markUnread, notice, rootOf, send, useStore } from '../app/store';
import { tauriInvoke } from '../app/runtime/tauri';
import { Icon } from '../ui/Icon';
import { MenuItem, MenuSeparator } from '../ui/Menu';
import { Row } from '../ui/Row';
import { type ConfirmRequest } from '../ui/Confirm';
import { type ChatRun, type LiveChat, type SavedSession } from '../../../shared/protocol';
import { providerMark, shortModel } from '../../../shared/providers';
import { save } from '../ui/util';
import { RenameInput } from './RenameInput';
import { ChatPr } from '../ops/pulls';
import { archiveChat, buildsState, chatMenuItems, nestChat, sectionChat, savedChats, chatSwipe, chatLine, chatBranch, chatState, closeChat, openChatWindow, renameChat, repoName, removeRequest, restoreChat, rootLookup, rowsById, since, type ChatSession, type ChatState, type Folder } from './folders';
import { askLine } from './runLogic';
import { Swipe } from '../codex/gestures/Swipe';
import { copyText, showSnack } from '../codex/view';
import { isMuted, setMuted } from '../app/runtime/mute';
import { draftKey, draftLine, readDraft } from '../chat/composer/composerLogic';
import { clock } from '../../../shared/util';
import { useChatRun } from './useChatRun';
import { BuildRows } from './BuildRows';
import { AskHover } from './AskHover';
import { QuickPick } from '../ui/QuickPick';
import { nestTargets } from '../../../shared/nest';
import { sectionChoices } from '../../../shared/sections';

type SetChats = (f: (l: SavedSession[]) => SavedSession[]) => void;
type Pin = (on: boolean) => Promise<boolean>;
type Actions = {
  rename: (id: string, title: string) => void;
  archive: (s: SavedSession, pinned: boolean, pin?: Pin) => void;
  archiveNow: (s: SavedSession, pinned: boolean, pin?: Pin) => void;
};

export const chatActions = (setChats: SetChats, ask: (r: ConfirmRequest) => void): Actions => {
  const archived = (s: SavedSession, pinned: boolean, pin?: Pin) => () => {
    const builds = new Set((s as ChatSession).buildMembers);
    setChats((l) => l.filter((x) => x.sessionId !== s.sessionId && x.parentId !== s.sessionId && !builds.has(x.sessionId)));
    showSnack('Archived', async () => {
      if (!(await restoreChat(s.sessionId))) return notice('Could not restore the chat. It is still in the bin.');
      setChats((l) => [s, ...l]);
      if (pinned) await pin?.(true);
    });
  };
  return {
    rename: (id, title) => void renameChat(id, title),
    archive: (s, pinned, pin) => ask(archiveChat(s, archived(s, pinned, pin), notice)),
    archiveNow: (s, pinned, pin) => removeRequest(s.sessionId, '&archive', archived(s, pinned, pin), notice)(),
  };
};

type ChatRowProps = {
  sessionId?: string;
  title: string;
  cwd: string;
  lastModified: number;
  live?: LiveChat;
  opening?: boolean;
  meta: ReactNode;
  state: ChatState | null;
  selected?: boolean;
  pinned?: boolean;
  actions: Actions;
  onOpen: () => void;
  onPin?: Pin;
  onBeside?: () => void;
  onClose?: () => void;
  nestedIn?: string;
  section?: string;
};

// Nest under: the other chats as a searchable list, folder on the right.
function NestPick({ id, onClose }: { id: string; onClose: () => void }) {
  const items = nestTargets(savedChats().filter((c) => !c.parentId), id).map((c) => ({ value: c.sessionId, label: c.title || 'Untitled', detail: c.cwd.split('/').pop() }));
  return <QuickPick title="Nest under" items={items} onPick={(parent) => { void nestChat(id, parent); onClose(); }} onClose={onClose} />;
}

// Move to section: the other sections with counts, and New section from the typed name.
function SectionPick({ id, onClose }: { id: string; onClose: () => void }) {
  const chats = savedChats();
  const current = chats.find((c) => c.sessionId === id)?.section;
  const items = sectionChoices(chats, current, '').list.map((s) => ({ value: s.name, label: s.name, detail: String(s.count) }));
  const extra = (q: string) => { const n = sectionChoices(chats, current, q).fresh; return n ? [{ value: n, label: `New section "${n}"` }] : []; };
  return <QuickPick title="Move to section" note={items.length ? undefined : 'Type a name for a new section'} items={items} extra={extra} onPick={(name) => { void sectionChat(id, name); onClose(); }} onClose={onClose} />;
}

// The chats nested under a row, indented below it; a tap opens one.
export function NestedRows({ chats }: { chats?: ChatSession[] }) {
  if (!chats?.length) return null;
  return <>{chats.map((c) => (
    <div key={c.sessionId} className="chat-row chat-build">
      <Row lines={1} data-chat-row title={c.title} meta={since(c.lastModified)} leading={<Icon name="indent" small />} onClick={() => send({ type: 'open_session', sessionId: c.sessionId })}
        menu={<MenuItem icon="debug-step-out" onClick={() => void nestChat(c.sessionId, '')}>Un-nest</MenuItem>} />
    </div>
  ))}</>;
}

function RunTag({ run }: { run: ChatRun }) {
  const paused = run.state === 'paused';
  return <span className={`chat-run ${paused ? 'warn' : ''}`}>{paused ? 'Paused' : <><Icon name="sync" small />{run.nextAt ? clock(run.nextAt) : 'Running'}</>}</span>;
}

const DOT = { needs: ['waiting', 'Needs you'], failed: ['bad', 'Failed'], running: ['running', 'Running'], done: ['unread', 'Unread'] } as const;

export const StateDot = ({ state }: { state?: ChatState | null }) => (state ? <span className={`dot ${DOT[state][0]}`} role="img" aria-label={DOT[state][1]} /> : <span className="dot idle" />);

function ChatRow({ sessionId, title, cwd, lastModified, live, opening, meta, state, selected, pinned, actions, onOpen, onPin, onBeside, onClose, nestedIn, section }: ChatRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [nesting, setNesting] = useState(false);
  const [sectioning, setSectioning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [muted, setMute] = useState(() => isMuted(sessionId));
  const run = useChatRun(live?.id);
  const shown = run?.needsYou ? 'needs' : state;
  const unread = shown === 'done' || shown === 'needs';
  useEffect(() => {
    if (!retrying) return;
    if (state !== 'failed') return setRetrying(false);
    const t = setTimeout(() => setRetrying(false), 3000);
    return () => clearTimeout(t);
  }, [retrying, state]);
  const rowKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    if (e.key.startsWith('Arrow')) e.preventDefault();
    const rows = [...document.querySelectorAll<HTMLElement>('.chats [data-chat-row]')];
    rows[rows.indexOf(e.currentTarget) + step]?.focus();
  };
  if (renaming) {
    const save = (t: string) => {
      setRenaming(false);
      actions.rename(sessionId!, t);
    };
    return <div className="chat-row"><Row plain title={<RenameInput value={title} onSave={save} onCancel={() => setRenaming(false)} />} /></div>;
  }
  const retry = () => {
    setRetrying(true);
    send({ type: 'view', id: live!.id });
    send({ type: 'retry' }, live!.id);
  };
  const resume = () => {
    send({ type: 'view', id: live!.id });
    send({ type: 'steer', text: 'continue' }, live!.id);
  };
  const swipe = chatSwipe(!!pinned, live);
  const saved: SavedSession = { sessionId: sessionId!, title, cwd, gitBranch: null, lastModified };
  const swipePin = async () => {
    const on = swipe.right === 'pin';
    if (await onPin!(on)) showSnack(on ? 'Pinned' : 'Unpinned', () => void onPin!(!on));
  };
  const row = (
    <div className={`chat-row ${unread ? 'unread' : ''}`}>
      <Row
        lines={1}
        data-chat-row
        onKeyDown={rowKey}
        title={opening ? `Opening… ${title}` : title}
        meta={meta}
        aria-current={selected || undefined}
        leading={<StateDot state={shown} />}
        state={run && !run.needsYou ? <RunTag run={run} /> : muted ? <span title="Muted" className="chat-muted"><Icon name="bell-slash" small /></span> : null}
        onClick={onOpen}
        onDoubleClick={sessionId ? (e) => { if ((e.target as HTMLElement).closest('.ui-row-title')) setRenaming(true); } : undefined}
        onLongPress={sessionId ? () => setRenaming(true) : undefined}
        menu={chatMenuItems({ failed: state === 'failed' && !!live, stalled: !!live?.stalled, canPin: !!sessionId && !!onPin, beside: !!onBeside, ownWindow: !!live && !embedded && !tauriInvoke(), closable: !!onClose, unread: !!sessionId && !shown && !selected, nested: !!nestedIn, inSection: !!section }).map((key) => {
          switch (key) {
            case 'resume': return <MenuItem key={key} icon="play" onClick={resume}>Resume</MenuItem>;
            case 'retry': return <MenuItem key={key} icon="refresh" disabled={retrying} onClick={retry}>Retry</MenuItem>;
            case 'pin': return <MenuItem key={key} icon={pinned ? 'pinned' : 'pin'} onClick={() => void onPin!(!pinned)}>{pinned ? 'Unpin' : 'Pin'}</MenuItem>;
            case 'unread': return <MenuItem key={key} icon="mail" onClick={() => markUnread(sessionId!)}>Mark as unread</MenuItem>;
            case 'mute': return <MenuItem key={key} icon={muted ? 'bell' : 'bell-slash'} onClick={() => { setMuted(sessionId!, !muted); setMute(!muted); }}>{muted ? 'Unmute' : 'Mute'}</MenuItem>;
            case 'link': return <MenuItem key={key} icon="link" onClick={() => copyText(`${location.origin}/?session=${sessionId}`, 'Link copied')}>Copy link</MenuItem>;
            case 'rename': return <MenuItem key={key} icon="edit" disabled={!sessionId} onClick={() => setRenaming(true)}>Rename</MenuItem>;
            case 'nest': return <MenuItem key={key} icon="indent" onClick={() => setNesting(true)}>Nest under…</MenuItem>;
            case 'unnest': return <MenuItem key={key} icon="debug-step-out" onClick={() => void nestChat(sessionId!, '')}>Un-nest</MenuItem>;
            case 'section': return <MenuItem key={key} icon="list-tree" onClick={() => setSectioning(true)}>Move to section…</MenuItem>;
            case 'unsection': return <MenuItem key={key} icon="close" onClick={() => void sectionChat(sessionId!, '')}>Remove from section</MenuItem>;
            case 'beside': return <MenuItem key={key} icon="split-horizontal" className="desktop-only" onClick={onBeside!}>Open beside</MenuItem>;
            case 'window': return <MenuItem key={key} icon="multiple-windows" className="desktop-only" onClick={() => openChatWindow(live!.id)}>Open in new window</MenuItem>;
            case 'close': return <MenuItem key={key} icon="close" onClick={onClose!}>Close chat</MenuItem>;
            case 'separator': return <MenuSeparator key={key} />;
            case 'archive': return <MenuItem key={key} icon="archive" danger disabled={!sessionId} onClick={() => actions.archive(saved, !!pinned, onPin)}>Archive</MenuItem>;
          }
        })}
      />
    </div>
  );
  const picked = !sessionId ? null : nesting ? <NestPick id={sessionId} onClose={() => setNesting(false)} /> : sectioning ? <SectionPick id={sessionId} onClose={() => setSectioning(false)} /> : null;
  if (!sessionId || !onPin) return <>{row}{picked}</>;
  return (
    <>
      <Swipe
        rightLabel={swipe.right === 'pin' ? 'Pin' : 'Unpin'}
        rightIcon={swipe.right === 'pin' ? 'pin' : 'pinned'}
        onRight={swipePin}
        leftLabel="Archive"
        leftIcon="archive"
        onLeft={swipe.left ? () => actions.archiveNow(saved, !!pinned, onPin) : undefined}
      >
        {row}
      </Swipe>
      {picked}
    </>
  );
}

export const metaLine = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

const draftMeta = (draft: string) => <><span className="chat-draft">Draft:</span> {draft}</>;

export function SavedRow({ s, repo, branch, opening, pinned, actions, onOpen, onPin, nested }: { s: ChatSession; repo?: string; branch?: string; opening: boolean; pinned: boolean; actions: Actions; onOpen: () => void; onPin: Pin; nested?: ChatSession[] }) {
  const seen = useStore((x) => x.seen);
  const builds = useStore((x) => buildsState(x.live, s.buildMembers));
  const draft = draftLine(readDraft(s.sessionId));
  return <><ChatRow sessionId={s.sessionId} title={s.title} cwd={s.cwd} lastModified={s.lastModified} opening={opening} meta={draft ? draftMeta(draft) : s.summary ? metaLine(since(s.lastModified), s.subs, s.summary) : metaLine(repo, chatBranch(s.gitBranch, branch), s.subs, providerMark(s.provider), since(s.lastModified))} state={chatState({ saved: s, builds }, seen)} pinned={pinned} actions={actions} onOpen={onOpen} onPin={onPin} nestedIn={s.nestedIn} section={s.section} /><BuildRows sessionId={s.sessionId} members={s.buildMembers} state={builds} /><NestedRows chats={nested} /></>;
}

export function WaitingRows({ rows, chats, folders, viewing, ask, pins, setPin, setChats }: { rows: LiveChat[]; chats: ChatSession[]; folders: Folder[]; viewing: string; ask: (r: ConfirmRequest) => void; pins: string[]; setPin: (id: string, on: boolean) => Promise<boolean>; setChats: SetChats }) {
  const actions = chatActions(setChats, ask);
  const root = rootLookup(chats);
  const byId = rowsById(chats);
  return <>{rows.map((c) => <LiveRow key={c.id} c={c} saved={c.sessionId ? byId.get(c.sessionId) : undefined} repo={repoName(folders, c.cwd)} selected={c.id === viewing} actions={actions} ask={ask} pinned={pins.some((p) => root(p) === root(c.sessionId))} onPin={(on) => setPin(root(c.sessionId)!, on)} />)}</>;
}

export function LiveRow({ c, saved, repo, branch, selected, pinned, actions, ask, onPin, onBeside, nested }: { c: LiveChat; saved?: ChatSession; repo?: string; branch?: string; selected: boolean; pinned?: boolean; actions: Actions; ask: (r: ConfirmRequest) => void; onPin?: Pin; onBeside?: () => void; nested?: ChatSession[] }) {
  const events = useStore((s) => (s.session.id === c.id ? s.events : null));
  const seen = useStore((s) => s.seen);
  const builds = useStore((s) => buildsState(s.live, saved?.buildMembers));
  const line = chatLine(c, events);
  const shownCwd = useStore((s) => s.session.cwd);
  const when = c.pending ? metaLine(c.ask, since(c.lastActive)) : c.stalled ? 'No activity for 15 min' : c.running ? line.text || 'Working' : metaLine(since(Math.max(c.lastActive, saved?.lastModified ?? 0)), askLine(c.run));
  // Slack's sidebar draft line: an unsent composer draft replaces the meta line, except in the chat you are in.
  const draft = selected ? '' : draftLine(readDraft(draftKey(c.id, c.sessionId), c.id));
  const main = draft ? draftMeta(draft) : (
    <>
      {metaLine(repo, chatBranch(saved?.gitBranch, branch), saved?.subs, c.model && shortModel(c.model), providerMark(c.provider), when)}
      {c.pr && <> · <ChatPr n={c.pr} checks={c.prChecks} cwd={c.cwd === shownCwd ? shownCwd : ''} /></>}
      {c.todos && ` · ${c.todos.done}/${c.todos.total}`}
      {line.edits && <> · <span className="chat-add">+{line.edits.add}</span> <span className="chat-del">-{line.edits.del}</span></>}
    </>
  );
  const row = <ChatRow sessionId={saved?.sessionId ?? rootOf(c.sessionId) ?? undefined} title={c.title} cwd={c.cwd} lastModified={saved?.lastModified ?? c.lastActive} live={c} meta={main} state={chatState({ live: c, saved, builds }, seen)} selected={selected} pinned={pinned} actions={actions} onOpen={() => { if (!selected) send({ type: 'view', id: c.id }); }} onPin={onPin} onBeside={onBeside} onClose={() => closeChat(c, ask)} nestedIn={saved?.nestedIn} section={saved?.section} />;
  return (
    <>
      {selected ? row : <AskHover c={c}>{row}</AskHover>}
      <BuildRows sessionId={saved?.sessionId} members={saved?.buildMembers} state={builds} />
      <NestedRows chats={nested} />
    </>
  );
}

