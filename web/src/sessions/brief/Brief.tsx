import { Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../app/store';
import { chatTitle as chatTitleOf } from '../../../../shared/util';
import { REVIEW_LOCAL } from '../../ops/Findings';
import { Pending } from '../../chat/cards/Pending';
import { Composer } from '../../chat/Chat';
import { Transcript } from '../../chat/transcript/Transcript';
import { createTurnsBuilder, type Turn } from '../../chat/transcript/turns';
import { AgentsPane, Loading, WorkPane } from '../../app/lazy';
import { RailHead } from './RailHead';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { agentsOf } from '../agents';
import { agentChipCount } from '../runLogic';
import { useChatRun } from '../useChatRun';
import { useNarrow } from '../../app/shell/useNarrow';
import { command, plural, useTick } from '../../ui/util';
import { newChat } from '../../app/newChat';
import { askChat } from '../../chat/chatActions';
import { useMacName } from '../../app/shell/macName';
import { useUsage } from '../../app/shell/StatusItems';
import { RenameInput } from '../RenameInput';
import { renameChat } from '../folders';
import { useLongPress } from '../../ui/longPress';
import { ChatDetailsMenu } from './ChatDetailsMenu';
import { HeadState } from './HeadState';
import { useGit } from '../../workspace/gitStatus';

function lastReplyOf(turns: Turn[]) {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].reply) return turns[i].reply;
}

export function Brief() {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const macName = useMacName();
  const stopping = useStore((s) => s.session.stopping);
  const cwd = useStore((s) => s.session.cwd);
  const sessionId = useStore((s) => s.session.id);
  const live = useStore((s) => s.live.find((c) => c.id === s.session.id));
  const chatTitle = live?.title;
  const savedId = live?.sessionId;
  const [renaming, setRenaming] = useState(false);
  const pending = useStore((s) => s.pending);
  const waiting = pending.length > 0;
  const [build] = useState(createTurnsBuilder);
  const { turns, next, lastTool, advisor, fable } = useMemo(() => build(events), [build, events]);
  const waitingElsewhere = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length + s.attention.length);
  const usage = useUsage();
  // The review reads the working tree, which can hold edits older than the loaded events.
  const uncommitted = (useGit().status?.files.length ?? 0) > 0;
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const extras = [advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');
  const lastReply = lastReplyOf(turns);
  const doneSteps = useMemo(() => (turns.at(-1)?.notes ?? []).filter((n) => n.kind === 'done' && n.id.endsWith(':done')), [turns]);
  const state = waiting ? 'waiting' : stopping ? 'stopping' : running ? 'running' : 'idle';
  const phone = useNarrow();
  const run = useChatRun(sessionId);
  const agentCount = agentChipCount(agentsOf(events).length, live?.agentList?.length ?? 0);
  // The agents and the run's controls live beside the chat on desktop and in a sheet the status line opens on the phone.
  const hasAgents = agentCount > 0 || Boolean(run);
  // On desktop a turn's tool calls open as a second rail tab beside Agents; the phone opens them as their own screen.
  const [workTurn, setWorkTurn] = useState<string | null>(null);
  const [railTab, setRailTab] = useState<'agents' | 'work'>('agents');
  // The rail starts closed in every chat and opens only from an agent, tool calls or the agents button in the status line.
  const [railClosed, setRailClosed] = useState(true);
  const showWork = !phone && workTurn !== null && (railTab === 'work' || !hasAgents);
  const side = hasAgents || (!phone && workTurn !== null);
  const closeWork = () => { setWorkTurn(null); setRailTab('agents'); };
  const tabs = !phone && workTurn !== null && (
    <div className="rail-h rail-tabs">
      {hasAgents && <button className={`rail-tab ${showWork ? '' : 'on'}`} onClick={() => setRailTab('agents')}>Agents</button>}
      <button className={`rail-tab ${showWork ? 'on' : ''}`} onClick={() => setRailTab('work')}>Tool calls</button>
      <IconButton icon="close" label="Close tool calls" size="sm" onClick={closeWork} />
    </div>
  );
  const rail = side && (
    <>
      {tabs}
      {showWork ? <Suspense fallback={<Loading />}><WorkPane turn={workTurn!} onBack={closeWork} /></Suspense> : <>
        <RailHead titled={!tabs} onClose={phone || tabs ? undefined : () => setRailClosed(true)} />
        {agentCount > 0 && <Suspense fallback={<Loading />}><AgentsPane stack selected={agentSel} onSelect={setAgentSel} /></Suspense>}
      </>}
    </>
  );

  useTick(30000);

  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      setAgentSel(typeof id === 'string' ? id : null);
      setShowAgents(true);
      setRailClosed(false);
    };
    window.addEventListener('open-agent', open);
    return () => window.removeEventListener('open-agent', open);
  }, []);
  useEffect(() => {
    if (phone) return;
    const open = (e: Event) => {
      setWorkTurn(String((e as CustomEvent<unknown>).detail));
      setRailTab('work');
      setRailClosed(false);
    };
    window.addEventListener('open-work', open);
    return () => window.removeEventListener('open-work', open);
  }, [phone]);
  useEffect(() => { setShowAgents(false); setAgentSel(null); setRenaming(false); setWorkTurn(null); setRailTab('agents'); setRailClosed(true); }, [sessionId]);
  const title = chatTitle || chatTitleOf(turns[0]?.prompt ?? '') || 'New chat';
  const startRename = savedId ? () => setRenaming(true) : undefined;
  const press = useLongPress(startRename);

  return (
    <div className="brief-row">
    <div className="brief">
      <div className="brief-status">
        <div className="timeline-head">
          {phone && <IconButton icon="menu" label="Chats" onClick={() => command('view:chats')} />}
          <span className="tl-name" title={cwd ? `${title}\n${cwd}` : title}>
            {renaming ? (
              <RenameInput value={title} onSave={(t) => { setRenaming(false); void renameChat(savedId!, t); }} onCancel={() => setRenaming(false)} />
            ) : (
              <b className={startRename ? 'editable' : undefined} onDoubleClick={startRename} onPointerDown={press?.down} onPointerMove={press?.move} onPointerUp={press?.up} onPointerCancel={press?.cancel} onContextMenu={press ? (e) => press.menu(e.nativeEvent) : undefined}>{title}</b>
            )}
            {cwd && <small>{cwd.split('/').pop()}</small>}
          </span>
          <span className="spacer" />
          {phone && <IconButton icon="edit" label="New chat" onClick={() => newChat({ cwd })} />}
          <ChatDetailsMenu icon={phone ? 'kebab-vertical' : undefined} waitingElsewhere={waitingElsewhere} usage={usage} macName={macName} extras={extras} running={running} hasChanges={uncommitted || turns.some((t) => t.files.length > 0)} review={() => askChat(REVIEW_LOCAL)} rename={startRename} />
        </div>
        <div className="tl-line">
          <HeadState state={state} status={status} chat={live} pending={pending.length} lastReply={lastReply} lastTool={lastTool} done={doneSteps} next={next} />
          {side && (phone || railClosed) && <button className="tl-agents" onClick={() => { if (phone) { setShowAgents(true); setAgentSel(null); } else setRailClosed(false); }}>{agentCount > 0 ? plural(agentCount, 'agent') : 'Run'}<Icon name="chevron-right" small /></button>}
        </div>
        <Transcript />
      </div>
      {waiting && <div className="brief-cards"><Pending /></div>}
      <div className="brief-input">
        <Composer />
      </div>
    </div>
    {!phone && side && !railClosed && <aside className={`brief-rail ${showWork ? 'wide' : ''}`}>{rail}</aside>}
    {phone && side && showAgents && <Sheet label="Agents" className="brief-sheet" onClose={() => { setShowAgents(false); setAgentSel(null); }}>{rail}</Sheet>}
    </div>
  );
}
