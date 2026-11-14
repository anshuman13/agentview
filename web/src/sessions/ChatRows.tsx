import { useEffect, useState, type ReactNode } from 'react';
import { getState, markUnread, notice, send, subscribe, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { MenuItem, MenuSeparator } from '../ui/Menu';
import { Row } from '../ui/Row';
import { type ConfirmRequest } from '../ui/Confirm';
import { type ChatRun, type LiveChat, type SavedSession } from '../../../shared/protocol';
import { providerMark } from '../../../shared/providers';
import { copyText, save } from '../ui/util';
import { RenameInput } from './RenameInput';
import { AgentsBlock } from './AgentRow';
import { openAgent } from './agents';
import { CheckIcon, prText, usePullRequests } from '../ops/pulls';
import { archiveChat, chatMenuItems, chatSwipe, chatLine, chatState, closeChat, isDefault, renameChat, removeRequest, restoreChat, since, type ChatState } from './folders';
import { Swipe } from '../codex/gestures/Swipe';
import { showSnack } from '../codex/view';
import { isMuted, setMuted } from '../app/runtime/mute';
import { draftLine, readDraft } from '../chat/composer/composerLogic';
import { clock } from '../codex/tasks/time';
import { useChatRun } from './runBands';

type SetChats = (f: (l: SavedSession[]) => SavedSession[]) => void;
type Pin = (on: boolean) => Promise<boolean>;
type Actions = {
  rename: (id: string, title: string) => void;
  archive: (s: { sessionId: string; title: string }) => void;
  archiveNow: (s: SavedSession, pinned: boolean, pin: Pin) => void;
};

export const chatActions = (setChats: SetChats, ask: (r: ConfirmRequest) => void): Actions => ({
  rename: async (id, title) => {
    if (await renameChat(id, title)) setChats((l) => l.map((x) => (x.sessionId === id ? { ...x, title } : x)));
  },
  archive: (s) => ask(archiveChat(s, () => setChats((l) => l.filter((x) => x.sessionId !== s.sessionId)), notice)),
  archiveNow: (s, pinned, pin) => removeRequest(s.sessionId, '&archive', () => {
    setChats((l) => l.filter((x) => x.sessionId !== s.sessionId));
    showSnack('Archived', async () => {
      if (!(await restoreChat(s.sessionId))) return notice('Could not restore the chat. It is still in the bin.');
      setChats((l) => [s, ...l]);
      if (pinned) await pin(true);
    });
  }, notice)(),
});

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
};

function RunTag({ run }: { run: ChatRun }) {
  const paused = run.state === 'paused';
  return <span className={`chat-run ${paused ? 'warn' : ''}`}>{paused ? 'Paused' : <><Icon name="sync" small />{run.nextAt ? clock(run.nextAt) : 'Running'}</>}</span>;
}

const DOT = { needs: ['waiting', 'Needs you'], failed: ['bad', 'Failed'], running: ['running', 'Running'], done: ['unread', 'Unread'] } as const;

export const StateDot = ({ state }: { state?: ChatState | null }) => (state ? <span className={`dot ${DOT[state][0]}`} role="img" aria-label={DOT[state][1]} /> : <span />);

function ChatRow({ sessionId, title, cwd, lastModified, live, opening, meta, state, selected, pinned, actions, onOpen, onPin, onBeside, onClose }: ChatRowProps) {
  const [renaming, setRenaming] = useState(false);
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
  const swipe = chatSwipe(!!pinned, live);
  const swipePin = async () => {
    const on = swipe.right === 'pin';
    if (await onPin!(on)) showSnack(on ? 'Pinned' : 'Unpinned', () => void onPin!(!on));
  };
  const row = (
    <div className={`chat-row ${unread ? 'unread' : ''}`}>
      <Row
        data-chat-row
        onKeyDown={rowKey}
        title={<span title={title}>{opening ? 'Opening… ' : ''}{title}</span>}
        meta={meta}
        aria-current={selected || undefined}
        leading={<StateDot state={shown} />}
        state={run && !run.needsYou ? <RunTag run={run} /> : muted ? <span title="Muted" className="chat-muted"><Icon name="bell-slash" small /></span> : null}
        onClick={onOpen}
        onDoubleClick={sessionId ? (e) => { if ((e.target as HTMLElement).closest('.ui-row-title')) setRenaming(true); } : undefined}
        onLongPress={sessionId ? () => setRenaming(true) : undefined}
        menu={chatMenuItems({ failed: state === 'failed' && !!live, canPin: !!sessionId && !!onPin, beside: !!onBeside, closable: !!onClose, unread: !!sessionId && !shown && !selected }).map((key) => {
          switch (key) {
            case 'retry': return <MenuItem key={key} icon="refresh" disabled={retrying} onClick={retry}>Retry</MenuItem>;
            case 'pin': return <MenuItem key={key} icon={pinned ? 'pinned' : 'pin'} onClick={() => void onPin!(!pinned)}>{pinned ? 'Unpin' : 'Pin'}</MenuItem>;
            case 'unread': return <MenuItem key={key} icon="mail" onClick={() => markUnread(sessionId!)}>Mark as unread</MenuItem>;
            case 'mute': return <MenuItem key={key} icon={muted ? 'bell' : 'bell-slash'} onClick={() => { setMuted(sessionId!, !muted); setMute(!muted); }}>{muted ? 'Unmute' : 'Mute'}</MenuItem>;
            case 'link': return <MenuItem key={key} icon="link" onClick={() => copyText(`${location.origin}/?session=${sessionId}`).then(() => notice('Copied the chat link'), () => notice('Could not copy'))}>Copy link</MenuItem>;
            case 'rename': return <MenuItem key={key} icon="edit" disabled={!sessionId} onClick={() => setRenaming(true)}>Rename</MenuItem>;
            case 'beside': return <MenuItem key={key} icon="split-horizontal" className="desktop-only" onClick={onBeside!}>Open beside</MenuItem>;
            case 'close': return <MenuItem key={key} icon="close" onClick={onClose!}>Close chat</MenuItem>;
            case 'separator': return <MenuSeparator key={key} />;
            case 'archive': return <MenuItem key={key} icon="archive" danger disabled={!sessionId} onClick={() => actions.archive({ sessionId: sessionId!, title })}>Archive</MenuItem>;
          }
        })}
      />
    </div>
  );
  if (!sessionId || !onPin) return row;
  return (
    <Swipe
      rightLabel={swipe.right === 'pin' ? 'Pin' : 'Unpin'}
      rightIcon={swipe.right === 'pin' ? 'pin' : 'pinned'}
      onRight={swipePin}
      leftLabel="Archive"
      leftIcon="archive"
      onLeft={swipe.left ? () => actions.archiveNow({ sessionId, title, cwd, gitBranch: null, lastModified }, !!pinned, onPin) : undefined}
    >
      {row}
    </Swipe>
  );
}

export const metaLine = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

const branchOf = (saved?: string | null, repoBranch?: string) => {
  const b = saved || repoBranch;
  return isDefault(b) ? undefined : b;
};

export function SavedRow({ s, repo, branch, opening, pinned, actions, onOpen, onPin }: { s: SavedSession; repo?: string; branch?: string; opening: boolean; pinned: boolean; actions: Actions; onOpen: () => void; onPin: Pin }) {
  const seen = useStore((x) => x.seen);
  return <ChatRow sessionId={s.sessionId} title={s.title} cwd={s.cwd} lastModified={s.lastModified} opening={opening} meta={metaLine(repo, branchOf(s.gitBranch, branch), providerMark(s.provider), since(s.lastModified))} state={chatState({ saved: s }, seen)} pinned={pinned} actions={actions} onOpen={onOpen} onPin={onPin} />;
}

export function WaitingRows({ viewing, ask, pins, setPin, setChats }: { viewing: string; ask: (r: ConfirmRequest) => void; pins: string[]; setPin: (id: string, on: boolean) => Promise<boolean>; setChats: SetChats }) {
  const live = useStore((s) => s.live);
  const actions = chatActions(setChats, ask);
  return <>{live.filter((c) => c.pending).map((c) => <LiveRow key={c.id} c={c} repo={c.cwd.split('/').pop()} selected={c.id === viewing} actions={actions} ask={ask} pinned={pins.includes(c.sessionId ?? '')} onPin={(on) => setPin(c.sessionId!, on)} />)}</>;
}

export function LiveRow({ c, saved, repo, branch, selected, pinned, actions, ask, onPin, onBeside }: { c: LiveChat; saved?: SavedSession; repo?: string; branch?: string; selected: boolean; pinned?: boolean; actions: Actions; ask: (r: ConfirmRequest) => void; onPin?: Pin; onBeside?: () => void }) {
  const events = useStore((s) => (s.session.id === c.id ? s.events : null));
  const seen = useStore((s) => s.seen);
  const line = chatLine(c, events);
  const shownCwd = useStore((s) => s.session.cwd);
  const pr = usePullRequests(c.pr && c.cwd === shownCwd ? shownCwd : '').find((p) => p.number === c.pr);
  const checks = pr?.checks ?? c.prChecks;
  const checkIcon = checks && checks !== 'none' && <CheckIcon state={checks} />;
  const when = c.pending ? since(c.lastActive) : c.stalled ? 'No activity for 15 min' : c.running ? line.text || 'Working' : since(Math.max(c.lastActive, saved?.lastModified ?? 0));
  // Slack's sidebar draft line: an unsent composer draft replaces the meta line, except in the chat you are in.
  const draft = selected ? '' : draftLine(readDraft(c.id));
  const main = draft ? <><span className="chat-draft">Draft:</span> {draft}</> : (
    <>
      {metaLine(repo, branchOf(saved?.gitBranch, branch), providerMark(c.provider), when)}
      {c.pr && <> · {pr ? <a className="chat-pr" href={pr.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{prText(c.pr, pr)}{checkIcon}</a> : <>#{c.pr}{checkIcon}</>}</>}
      {c.todos && ` · ${c.todos.done}/${c.todos.total}`}
      {line.edits && <> · <span className="chat-add">+{line.edits.add}</span> <span className="chat-del">-{line.edits.del}</span></>}
    </>
  );
  return (
    <>
      <ChatRow sessionId={c.sessionId ?? undefined} title={c.title} cwd={c.cwd} lastModified={saved?.lastModified ?? c.lastActive} live={c} meta={main} state={chatState({ live: c, saved }, seen)} selected={selected} pinned={pinned} actions={actions} onOpen={() => { if (!selected) send({ type: 'view', id: c.id }); }} onPin={onPin} onBeside={onBeside} onClose={() => closeChat(c, ask)} />
      {c.agentList && <LiveAgents c={c} />}
    </>
  );
}

const agentsOpen = new Set<string>();
let stopWaiting: (() => void) | null = null;

// Opens an agent of another chat once the switch to that chat lands, after Brief resets its selection.
function openAgentIn(chat: string, id: string) {
  stopWaiting?.();
  const stop = subscribe(() => {
    if (getState().session.id !== chat) return;
    stop();
    stopWaiting = null;
    setTimeout(() => openAgent(id), 0);
  });
  stopWaiting = stop;
  setTimeout(() => { if (stopWaiting === stop) { stop(); stopWaiting = null; } }, 10_000);
  send({ type: 'view', id: chat });
}

function LiveAgents({ c }: { c: LiveChat }) {
  const [open, setOpen] = useState(() => agentsOpen.has(c.id));
  const viewing = useStore((s) => s.session.id);
  const toggle = () => {
    if (open) agentsOpen.delete(c.id);
    else agentsOpen.add(c.id);
    setOpen(!open);
  };
  const pick = (id: string) => {
    if (c.id === viewing) return openAgent(id);
    openAgentIn(c.id, id);
  };
  return <AgentsBlock agents={c.agentList!} open={open} onToggle={toggle} onOpen={pick} />;
}
