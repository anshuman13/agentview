import { Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../app/store';
import { chatTitle as chatTitleOf } from '../../../../shared/util';
import { REVIEW_LOCAL } from '../../ops/Findings';
import { Pending } from '../../chat/cards/Pending';
import { Composer } from '../../chat/Chat';
import { Transcript } from '../../chat/transcript/Transcript';
import { createTurnsBuilder, type Turn } from '../../chat/transcript/turns';
import { AgentsPane, Loading } from '../../app/lazy';
import { agentCounts, agentsOf } from '../agents';
import { askChat, readFlag, saveFlag, useTick } from '../../ui/util';
import { useMacName } from '../../app/shell/macName';
import { useUsage } from '../../app/shell/StatusItems';
import { RenameInput } from '../RenameInput';
import { renameChat } from '../folders';
import { useLongPress } from '../../ui/longPress';
import { ChatDetailsMenu } from './ChatDetailsMenu';
import { HeadState } from './HeadState';
import { narrow } from '../../app/shell/useNarrow';
import { useGit } from '../../workspace/gitStatus';

function lastReplyOf(turns: Turn[]) {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].reply) return turns[i].reply;
}

// After a usage limit the last prompt can be sent again when the limit resets.
function usageLimitOf(turns: Turn[]) {
  const t = turns[turns.length - 1];
  const m = t && !t.phase ? /^Usage limit reached, resets at (\d\d:\d\d)/.exec(t.notes.at(-1)?.text ?? '') : null;
  return m ? { at: m[1], prompt: t.prompt } : null;
}

export function Brief() {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const macName = useMacName();
  const stopping = useStore((s) => s.session.stopping);
  const loop = useStore((s) => s.session.loop);
  const repeat = useStore((s) => s.session.repeat);
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
  const [showWork, setShowWork] = useState(() => readFlag('agentview.showWork', false));
  const toggleWork = () => { setShowWork(!showWork); saveFlag('agentview.showWork', !showWork); };
  const agents = useMemo(() => agentsOf(events), [events]);
  const { running: agentsRunning, done: agentsDone } = agentCounts(agents);
  const waitingElsewhere = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length + s.attention.length);
  const usage = useUsage();
  // The review reads the working tree, which can hold edits older than the loaded events.
  const uncommitted = (useGit().status?.files.length ?? 0) > 0;
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const extras = [advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');
  const lastReply = lastReplyOf(turns);
  const doneSteps = useMemo(() => (turns.at(-1)?.notes ?? []).filter((n) => n.kind === 'done' && n.id.endsWith(':done')), [turns]);
  const limit = useMemo(() => usageLimitOf(turns), [turns]);
  const state = waiting ? 'waiting' : stopping ? 'stopping' : running ? 'running' : 'idle';

  useTick(30000);

  useEffect(() => {
    const open = (e: Event) => {
      if (narrow()) return;
      const id = (e as CustomEvent<unknown>).detail;
      setAgentSel(typeof id === 'string' ? id : null);
      setShowAgents(true);
    };
    window.addEventListener('open-agent', open);
    return () => window.removeEventListener('open-agent', open);
  }, []);
  useEffect(() => { setShowAgents(false); setAgentSel(null); setRenaming(false); }, [sessionId]);
  const title = chatTitle || chatTitleOf(turns[0]?.prompt ?? '') || 'New chat';
  const startRename = savedId ? () => setRenaming(true) : undefined;
  const press = useLongPress(startRename);

  return (
    <div className="brief">
      <div className="brief-status">
        <div className="timeline-head">
          <span className="tl-name" title={cwd ? `${title}\n${cwd}` : title}>
            {renaming ? (
              <RenameInput value={title} onSave={(t) => { setRenaming(false); void renameChat(savedId!, t); }} onCancel={() => setRenaming(false)} />
            ) : (
              <b className={startRename ? 'editable' : undefined} onDoubleClick={startRename} onPointerDown={press?.down} onPointerMove={press?.move} onPointerUp={press?.up} onPointerCancel={press?.cancel} onContextMenu={press ? (e) => press.menu(e.nativeEvent) : undefined}>{title}</b>
            )}
            {cwd && <small>{cwd.split('/').pop()}</small>}
          </span>
          <span className="spacer" />
          <HeadState state={state} status={status} loop={loop} repeat={repeat} chat={live} pending={pending.length} lastReply={lastReply} lastTool={lastTool} limit={limit} done={doneSteps} next={next} />
          <ChatDetailsMenu showWork={showWork} toggleWork={toggleWork} hasAgents={agents.length > 0} showAgents={showAgents} agentsRunning={agentsRunning} agentsDone={agentsDone} waitingElsewhere={waitingElsewhere} usage={usage} macName={macName} extras={extras} openAgents={() => { setShowAgents(!showAgents); setAgentSel(null); }} running={running} hasChanges={uncommitted || turns.some((t) => t.files.length > 0)} review={() => askChat(REVIEW_LOCAL)} rename={startRename} />
        </div>
        {showAgents ? <Suspense fallback={<Loading />}><AgentsPane stack selected={agentSel} onSelect={setAgentSel} /></Suspense> : <Transcript showWork={showWork} />}
      </div>
      {waiting && <div className="brief-cards"><Pending /></div>}
      <div className="brief-input">
        <Composer />
      </div>
    </div>
  );
}
