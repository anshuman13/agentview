import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Pending } from '../../chat/cards/Pending';
import { Composer } from '../../chat/Chat';
import { Transcript } from '../../chat/transcript/Transcript';
import { createTurnsBuilder, type Turn } from '../../chat/transcript/turns';
import { AgentsPane } from '../AgentsPane';
import { agentCounts, agentsOf } from '../agents';
import { readFlag, saveFlag, useTick } from '../../ui/util';
import { useMacName } from '../../app/shell/macName';
import { useUsage } from '../../app/shell/StatusItems';
import { ChatDetailsMenu } from './ChatDetailsMenu';
import { TimelineFoot } from './TimelineFoot';
import { useBriefScroll, useRecap } from './briefHooks';

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
  const chatTitle = useStore((s) => s.live.find((c) => c.id === s.session.id)?.title);
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
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const extras = [advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');
  const lastReply = lastReplyOf(turns);
  const limit = useMemo(() => usageLimitOf(turns), [turns]);
  const state = waiting ? 'waiting' : stopping ? 'stopping' : running ? 'running' : 'idle';

  useTick(30000);

  useEffect(() => {
    const open = (e: Event) => {
      if (window.innerWidth <= 900) return;
      const id = (e as CustomEvent<unknown>).detail;
      setAgentSel(typeof id === 'string' ? id : null);
      setShowAgents(true);
    };
    window.addEventListener('open-agent', open);
    return () => window.removeEventListener('open-agent', open);
  }, []);
  useEffect(() => { setShowAgents(false); setAgentSel(null); }, [sessionId]);
  const { since, dismiss } = useRecap(sessionId, events, waiting, root);
  const end = useBriefScroll(root, { turns: turns.length, next: next.length, running, waiting }, [sessionId, showAgents]);

  return (
    <div className="brief" ref={root}>
      <div className="brief-status">
        <div className="timeline-head">
          <span className="mobile-only tl-name"><b>{chatTitle || turns[0]?.prompt || 'New chat'}</b>{cwd && <small>{cwd.split('/').pop()}</small>}</span>
          <span className="spacer" />
          <ChatDetailsMenu showWork={showWork} toggleWork={toggleWork} hasAgents={agents.length > 0} showAgents={showAgents} agentsRunning={agentsRunning} agentsDone={agentsDone} waitingElsewhere={waitingElsewhere} usage={usage} macName={macName} extras={extras} openAgents={() => { setShowAgents(!showAgents); setAgentSel(null); }} />
        </div>
        {since?.chat === sessionId && (
          <button className="tl-recap" title="Tap to dismiss" onClick={dismiss}><Icon name="history" small /><span className="tl-recap-lines">{since.lines.map((l) => <span key={l}>{l}</span>)}</span></button>
        )}
        {showAgents ? <AgentsPane stack selected={agentSel} onSelect={setAgentSel} /> : <Transcript showWork={showWork} />}
        {!showAgents && <TimelineFoot state={state} status={status} loop={loop} repeat={repeat} lastReply={lastReply} lastTool={lastTool} limit={limit} next={next} running={running} end={end} />}
      </div>
      {waiting && <div className="brief-cards"><Pending /></div>}
      <div className="brief-input">
        <Composer />
      </div>
    </div>
  );
}
