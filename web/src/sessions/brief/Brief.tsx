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
import { turnEvents } from '../../chat/transcript/summary';
import { TurnCard } from './TurnCard';
import { useBriefScroll, useRecap } from './briefHooks';

const SHOWN_TURNS = 5;

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
  const cuts = useMemo(() => new Map(turnEvents(events).map((t) => [t.id, t.events])), [events]);
  const [all, setAll] = useState(false);
  const [full, setFull] = useState(() => readFlag('agentview.transcript', false));
  const pick = (v: boolean) => { setFull(v); saveFlag('agentview.transcript', v); };
  const agents = useMemo(() => agentsOf(events), [events]);
  const { running: agentsRunning, done: agentsDone } = agentCounts(agents);
  const waitingElsewhere = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length + s.attention.length);
  const usage = useUsage();
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const from = all ? 0 : Math.max(0, turns.length - SHOWN_TURNS);
  const shown = turns.slice(from);
  const extras = [advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');
  const hasActions = agents.length > 0 || showAgents || waitingElsewhere > 0 || Boolean(usage);
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
  useEffect(() => { setShowAgents(false); setAgentSel(null); setAll(false); }, [sessionId]);

  const { since, dismiss } = useRecap(sessionId, events, waiting, root);
  const end = useBriefScroll(root, { turns: turns.length, next: next.length, running, waiting }, [sessionId, full, showAgents]);

  return (
    <div className="brief" ref={root}>
      <div className="brief-status">
        <div className="timeline-head">
          <span className="mobile-only tl-name"><b>{chatTitle || turns[0]?.prompt || 'New chat'}</b>{cwd && <small>{cwd.split('/').pop()}</small>}</span>
          <button className={`tl-view tl-tab ${showAgents ? '' : 'active'}`} title={showAgents ? 'Show the chat' : full ? 'Show the timeline' : 'Show the full transcript'} onClick={() => (showAgents ? setShowAgents(false) : pick(!full))}>
            <span className="tl-view-label">{full ? 'Transcript' : 'Timeline'}</span>{!showAgents && <Icon name="arrow-swap" small />}
          </button>
          <span className="spacer" />
          {(hasActions || Boolean(macName || extras)) && (
            <ChatDetailsMenu hasAgents={agents.length > 0} showAgents={showAgents} agentsRunning={agentsRunning} agentsDone={agentsDone} waitingElsewhere={waitingElsewhere} usage={usage} macName={macName} extras={extras} hasActions={hasActions} openAgents={() => { setShowAgents(true); setAgentSel(null); }} />
          )}
        </div>
        {since?.chat === sessionId && (
          <button className="tl-recap" title="Tap to dismiss" onClick={dismiss}><Icon name="history" small /><span className="tl-recap-lines">{since.lines.map((l) => <span key={l}>{l}</span>)}</span></button>
        )}
        {showAgents ? <AgentsPane stack selected={agentSel} onSelect={setAgentSel} /> : full ? <Transcript /> : (
          <div className="turns">
            {turns.length === 0 && <div className="tl-empty">Send a prompt. Each prompt shows up here with the agent's reply, the files it changed and the commands it ran.</div>}
            {from > 0 && <button className="link tc-earlier" onClick={() => setAll(true)}>Show {from} earlier turn{from === 1 ? '' : 's'}</button>}
            {shown.map((t, i) => {
              const latest = i === shown.length - 1;
              return <TurnCard key={t.id} turn={t} events={cuts.get(t.id) ?? []} latest={latest} live={latest && running} cwd={cwd} pending={latest ? pending : []} />;
            })}
          </div>
        )}
        {!showAgents && <TimelineFoot state={state} status={status} loop={loop} repeat={repeat} lastReply={lastReply} lastTool={lastTool} limit={limit} next={next} running={running} end={end} />}
      </div>
      {waiting && <div className="brief-cards"><Pending /></div>}
      <div className="brief-input">
        <Composer />
      </div>
    </div>
  );
}
