import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { send, setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { BlockedCard, Pending } from './Pending';
import { Composer, Markdown } from './Chat';
import { clock, loopLabel } from './Composer';
import { ReadAloud } from './Voice';
import { touch } from '../touch';
import { Row, Transcript } from './Transcript';
import { FileIcon } from './Explorer';
import { relPath } from './steps';
import { BIG_BRO, buildTurns, elapsed, money, type Turn } from './turns';
import { markSeen, readSeen, recap, recapText } from './recap';
import { AgentsChip, AgentsPane, openAgent } from './AgentsPane';
import { agentCounts, agentsOf } from './agents';
import { REVIEW_LOCAL } from './Findings';
import { ago, plural, readFlag, saveFlag, useTick } from './util';
import { useMacName } from '../MacsPopover';
import type { PendingRequest } from '../../../shared/protocol';

const SHOWN_TURNS = 5;

// Items waiting outside this chat: other chats needing you plus the GitHub, Sentry and deploy inbox.
function InboxChip() {
  const n = useStore((s) => s.live.filter((c) => c.id !== s.session.id && c.pending > 0).length + s.attention.length);
  if (!n) return null;
  return (
    <button className="ag-chip inbox" title="Show what needs you" onClick={() => window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id: 'view:chats' } }))}>
      <Icon name="inbox" small /> {n} waiting
    </button>
  );
}

export function Brief() {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const team = useStore((s) => s.session.team);
  const macName = useMacName();
  const stopping = useStore((s) => s.session.stopping);
  const loop = useStore((s) => s.session.loop);
  const repeat = useStore((s) => s.session.repeat);
  const cwd = useStore((s) => s.session.cwd);
  const sessionId = useStore((s) => s.session.id);
  const pending = useStore((s) => s.pending);
  const waiting = pending.length > 0;
  const { turns, next, lastTool, advisor, fable } = useMemo(() => buildTurns(events), [events]);
  const [all, setAll] = useState(false);
  const [full, setFull] = useState(() => readFlag('agentview.transcript', false));
  const pick = (v: boolean) => { setFull(v); saveFlag('agentview.transcript', v); };
  const [adding, setAdding] = useState(false);
  const agents = useMemo(() => agentsOf(events), [events]);
  const agentsRunning = agentCounts(agents).running;
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(() => readFlag('agentview.steps', !touch()));
  const toggleSteps = () => { setStepsOpen(!stepsOpen); saveFlag('agentview.steps', !stepsOpen); };
  const end = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const recapFor = useRef('');
  const [since, setSince] = useState<{ chat: string; text: string } | null>(null);
  const from = all ? 0 : Math.max(0, turns.length - SHOWN_TURNS);
  const shown = turns.slice(from);
  const extras = [team && 'Team', advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');
  const setNext = (list: string[]) => send({ type: 'plan', next: list });
  const lastReply = [...turns].reverse().find((t) => t.reply)?.reply;
  // After a usage limit the last prompt can be sent again when the limit resets.
  const limit = useMemo(() => {
    const t = turns[turns.length - 1];
    const m = t && !t.phase ? /^Usage limit reached, resets at (\d\d:\d\d)/.exec(t.notes.at(-1)?.text ?? '') : null;
    return m ? { at: m[1], prompt: t.prompt } : null;
  }, [turns]);
  const hasSteps = next.length > 0 || adding || running;
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

  // On opening a chat, sum what happened after the last event this browser saw; then keep the seen id current while the chat is on screen.
  useEffect(() => {
    if (!sessionId || !events.length) return;
    if (recapFor.current !== sessionId) {
      recapFor.current = sessionId;
      const r = recap(events, readSeen(sessionId), waiting);
      setSince(r ? { chat: sessionId, text: recapText(r) } : null);
    }
    const mark = () => { if (document.visibilityState === 'visible' && root.current?.getClientRects().length) markSeen(sessionId, events); };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [sessionId, events]);
  const dismissSince = () => { markSeen(sessionId, events); setSince(null); };

  // The end marker sits inside the sticky foot, so scrollIntoView never moves the list; scroll the pane itself.
  const scrollEnd = (always: boolean) => {
    const sc = end.current?.closest('.brief-status');
    if (sc && (always || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 400)) sc.scrollTop = sc.scrollHeight;
  };
  useEffect(() => scrollEnd(false), [turns.length, next.length, running, waiting]);

  // Cards settle after the first paint (clipped replies, the plan card), so scroll once more a moment later.
  useEffect(() => {
    scrollEnd(true);
    const t = setTimeout(() => scrollEnd(true), 400);
    return () => clearTimeout(t);
  }, [sessionId]);

  return (
    <div className="brief" ref={root}>
      <div className="brief-status">
        <div className="timeline-head">
          <button className={`tl-view tl-tab ${showAgents ? '' : 'active'}`} title={showAgents ? 'Show the chat' : full ? 'Show the timeline' : 'Show the full transcript'} onClick={() => (showAgents ? setShowAgents(false) : pick(!full))}>
            {full ? 'Transcript' : 'Timeline'}{!showAgents && <Icon name="arrow-swap" small />}
          </button>
          {(agents.length > 0 || showAgents) && (
            <button className={`tl-view tl-tab desktop-only ${showAgents ? 'active' : ''}`} title="Show the agents" onClick={() => { setShowAgents(true); if (showAgents) setAgentSel(null); }}>
              Agents{agentsRunning > 0 ? <Icon name="loading" small spin /> : <span className="count">{agents.length}</span>}
            </button>
          )}
          <span className="spacer" />
          <span className="mobile-only"><AgentsChip /></span>
          <InboxChip />
          {macName && <span className="mobile-only mac-here"><Icon name="vm" small /> {macName}</span>}
          {extras && <span className="extras">{extras}</span>}
          <span className="desktop-only"><ReadAloud speak /></span>
        </div>
        {since?.chat === sessionId && (
          <button className="tl-recap" title="Tap to dismiss" onClick={dismissSince}><Icon name="history" small />{since.text}</button>
        )}
        {showAgents ? <AgentsPane stack selected={agentSel} onSelect={setAgentSel} /> : full ? <Transcript /> : (
          <div className="turns">
            {turns.length === 0 && <div className="tl-empty">Send a prompt. Each prompt shows up here with Claude's reply, the files it changed and the commands it ran.</div>}
            {from > 0 && <button className="link tc-earlier" onClick={() => setAll(true)}>Show {from} earlier turn{from === 1 ? '' : 's'}</button>}
            {shown.map((t, i) => {
              const latest = i === shown.length - 1;
              return <TurnCard key={t.id} turn={t} latest={latest} live={latest && running} cwd={cwd} pending={latest ? pending : []} />;
            })}
          </div>
        )}
        {!showAgents && <div className="tl-foot">
          <div className={`tl-now ${state}`}>
            <span className="mark"><Icon name={state === 'waiting' ? 'bell-dot' : state === 'idle' ? 'circle-large-outline' : 'loading'} small spin={state === 'running' || state === 'stopping'} /></span>
            <span className="text">
              {state === 'waiting' ? 'Waiting for you' : state === 'stopping' ? 'Stopping…' : state === 'running' ? (loop.phase && ['plan', 'build', 'test'].includes(loop.phase) ? `${loopLabel(loop)} · ${status}` : status) : repeat?.nextAt ? `Idle · next loop round ${clock(repeat.nextAt)}` : lastReply ? 'Idle · last reply' : 'Idle'}
              {state === 'running' && lastTool?.kind === 'tool_use' && <span className="tool">{lastTool.summary}</span>}
            </span>
            <span className="side">
              {state === 'idle' && !repeat && limit && <button className="link" title="Send the last prompt again when the limit resets" onClick={() => send({ type: 'prompt', text: `/loop at ${limit.at} ${limit.prompt}` })}>Continue at {limit.at}</button>}
              {state === 'idle' && lastReply && <span className="when" title={new Date(lastReply.at).toLocaleString()}>{time(lastReply.at)}</span>}
              {hasSteps && (
                <button className="steps-toggle" aria-expanded={stepsOpen} title={stepsOpen ? 'Hide the next steps' : 'Show the next steps'} onClick={toggleSteps}>
                  {next.length ? `${next.length} step${next.length === 1 ? '' : 's'}` : 'Steps'}<Icon name={stepsOpen ? 'chevron-up' : 'chevron-down'} small />
                </button>
              )}
            </span>
          </div>
          {hasSteps && stepsOpen && (
            <ul className="steps">
              {next.map((t, i) => (
                <Step key={`${i}:${t}`} text={t} onSave={(v) => setNext(next.map((x, j) => (j === i ? v : x)).filter(Boolean))} onDrop={() => setNext(next.filter((_, j) => j !== i))} />
              ))}
              {adding ? (
                <Step text="" editing onSave={(v) => { setAdding(false); if (v) setNext([...next, v]); }} onDrop={() => setAdding(false)} />
              ) : (
                <li className="step add"><button className="link" onClick={() => setAdding(true)}><Icon name="add" small /> Add a step</button></li>
              )}
            </ul>
          )}
          <div ref={end} />
        </div>}
      </div>
      {waiting && <div className="brief-cards"><Pending /></div>}
      <div className="brief-input">
        <Composer />
      </div>
    </div>
  );
}

const CLAUDE = <svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const FILES_SHOWN = 6;

function TurnCard({ turn, latest, live, cwd, pending }: { turn: Turn; latest: boolean; live: boolean; cwd: string; pending: PendingRequest[] }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const when = turn.queued ? <span className="tl-state" title="Queued, sends when Claude finishes"><Icon name="clock" small /></span> : turn.stopping ? <span className="tl-state" title="Stopping the current step"><Icon name="loading" small spin /></span> : <span className="when" title={new Date(turn.at).toLocaleString()}>{time(turn.at)}</span>;
  return (
    <section className={`tc ${latest ? 'latest' : ''}`}>
      {turn.prompt && (
        <div className={`tc-prompt ${turn.phase ? 'phase' : ''} ${promptOpen ? 'open' : ''}`} onClick={() => setPromptOpen((v) => !v)}>
          <span className="mark"><Icon name={turn.phase ? 'sync' : 'comment'} small /></span>
          <span className="text">{turn.prompt}</span>
          {when}
        </div>
      )}
      {turn.reply && <Reply text={turn.reply.text} clip={!latest} />}
      <Facts turn={turn} cwd={cwd} pending={pending} latest={latest && !live} settled={!live} />
      {turn.steps.length > 0 && (
        <button className="tc-steps-toggle" aria-expanded={stepsOpen} onClick={() => setStepsOpen((v) => !v)}>
          <Icon name={stepsOpen ? 'chevron-down' : 'chevron-right'} small />Steps ({turn.steps.length})
        </button>
      )}
      {stepsOpen && <div className="tr tc-steps">{turn.steps.map((it) => <Row key={it.id} it={it} cwd={cwd} settled={!live} />)}</div>}
    </section>
  );
}

function Reply({ text, clip }: { text: string; clip: boolean }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (clip && body.current) setLong(body.current.scrollHeight > body.current.clientHeight + 2);
  }, [clip, text]);
  const cut = clip && !open;
  return (
    <div className="tc-reply">
      <span className="mark">{CLAUDE}</span>
      <div className="reply-card">
        <div ref={body} className={`reply-body ${!cut ? 'open' : long ? 'clipped' : ''}`}><Markdown text={text} /></div>
        {clip && (long || open) && <button className="link" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Show more'}</button>}
      </div>
    </div>
  );
}

const rewindRequest = (turn: Turn): ConfirmRequest => ({
  title: 'Rewind files?',
  detail: `Puts every file Claude changed back to how it was before "${turn.prompt.split('\n')[0].slice(0, 80)}". Edits from later turns are undone too; the conversation stays.`,
  action: 'Rewind',
  icon: 'discard',
  run: async () => send({ type: 'rewind', id: turn.id }),
});

function Facts({ turn, cwd, pending, latest, settled }: { turn: Turn; cwd: string; pending: PendingRequest[]; latest: boolean; settled: boolean }) {
  const [allFiles, setAllFiles] = useState(false);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const failed = turn.commands.filter((c) => c.error);
  const refused = turn.commands.filter((c) => c.denied);
  const files = allFiles ? turn.files : turn.files.slice(0, FILES_SHOWN);
  const add = turn.files.reduce((n, f) => n + f.add, 0);
  const del = turn.files.reduce((n, f) => n + f.del, 0);
  const meta = [turn.cost !== undefined && money(turn.cost), turn.ended !== undefined && elapsed(turn.ended - turn.at)].filter(Boolean).join(' · ');
  const any = pending.length || turn.blocked.length || turn.notes.length || turn.files.length || turn.commits.length || turn.commands.length || turn.agents.length || meta;
  if (!any) return null;
  return (
    <div className="tc-facts">
      {pending.map((p) => (
        <div key={p.id} className="tc-wait"><Icon name="bell-dot" small /><span>{p.kind === 'question' ? p.questions[0]?.question ?? 'Claude has a question' : p.title}</span></div>
      ))}
      {turn.blocked.map((b) => <BlockedCard key={b.id} ev={b} />)}
      {turn.notes.length > 0 && (
        <ul className="tc-notes">
          {turn.notes.map((n) => (
            <li key={n.id} className={`tc-note ${n.kind}`}>
              <span className="mark">{n.kind === 'important' ? <i className="dot" /> : <Icon name={n.kind === 'fable' ? 'sparkle' : 'check'} small />}</span>
              <span className="text">{n.kind === 'fable' && <b>Fable: </b>}{n.text}</span>
            </li>
          ))}
        </ul>
      )}
      {turn.files.length > 0 && (
        <div className="tc-group">
          <div className="tc-label">{plural(turn.files.length, 'file')} changed <span className="tr-count"><span className="add">+{add}</span> <span className="del">-{del}</span></span></div>
          {files.map((f) => {
            const rel = relPath(f.path, cwd);
            const cut = rel.lastIndexOf('/');
            const name = rel.slice(cut + 1);
            return (
              <button key={f.path} className="tc-file" title={rel} onClick={() => setUi({ openFile: rel, follow: false })}>
                <FileIcon name={name} />
                <span className="tr-path"><span className="tr-dir">{cut >= 0 ? rel.slice(0, cut + 1) : ''}</span>{name}</span>
                <span className="tr-count"><span className="add">+{f.add}</span> <span className="del">-{f.del}</span></span>
              </button>
            );
          })}
          {turn.files.length > FILES_SHOWN && <button className="link" onClick={() => setAllFiles((v) => !v)}>{allFiles ? 'Show fewer' : `${turn.files.length - FILES_SHOWN} more`}</button>}
          {latest && <button className="link" title="Claude reviews the working tree, findings show in the Changes view" onClick={() => send({ type: 'prompt', text: REVIEW_LOCAL })}>Review changes</button>}
          {settled && <button className="link" title="Put the files back to how they were before this prompt" onClick={() => setAsk(rewindRequest(turn))}>Rewind files</button>}
          {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
        </div>
      )}
      {turn.commits.length > 0 && (
        <div className="tc-group">
          {turn.commits.map((c) => (
            <div key={c.hash} className="tc-commit" title={c.hash}><Icon name="git-commit" small /><code>{c.hash.slice(0, 7)}</code><span className="text">{c.subject}</span></div>
          ))}
        </div>
      )}
      {turn.commands.length > 0 && (
        <div className="tc-group">
          <div className="tc-label">Ran {plural(turn.commands.length, 'command')}{failed.length > 0 && <span className="tc-bad">, {failed.length} failed</span>}{refused.length > 0 && <span className="tc-muted">, {refused.length} denied</span>}</div>
          {failed.map((c) => (
            <div key={c.id} className="tc-fail" title={c.error}><span className="tc-cmd">{c.label}</span><span className="tc-err">{c.error}</span></div>
          ))}
          {refused.map((c) => (
            <div key={c.id} className="tc-fail denied" title="You denied this command"><span className="tc-cmd">{c.label}</span><span className="tc-err">Denied</span></div>
          ))}
        </div>
      )}
      {turn.agents.length > 0 && (
        <div className="tc-agents">
          {turn.agents.map((a) => (
            <button key={a.id} className={`tc-agent ${a.state}`} title={a.label} onClick={() => openAgent(a.id)}>
              <i className="tr-ring" /><span className="name">{a.type === BIG_BRO ? `Fable: ${a.label}` : a.label}</span><span className="state">{a.state}</span>
            </button>
          ))}
        </div>
      )}
      {meta && <div className="tc-label tc-meta" title="Cost of this turn and the time it took">{meta}</div>}
    </div>
  );
}

function Step({ text, editing = false, onSave, onDrop }: { text: string; editing?: boolean; onSave: (v: string) => void; onDrop: () => void }) {
  const [edit, setEdit] = useState(editing);
  const [value, setValue] = useState(text);
  if (edit) {
    const done = () => { setEdit(false); if (value.trim() !== text) onSave(value.trim()); else if (!text) onDrop(); };
    return (
      <li className="step editing">
        <input
          autoFocus
          value={value}
          placeholder="Describe the step"
          onChange={(e) => setValue(e.target.value)}
          onBlur={done}
          onKeyDown={(e) => {
            if (e.key === 'Enter') done();
            if (e.key === 'Escape') { setValue(text); setEdit(false); if (!text) onDrop(); }
          }}
        />
        <button className="icon-btn" title="Remove step" onPointerDown={(e) => e.preventDefault()} onClick={() => { setEdit(false); onDrop(); }}><Icon name="trash" small /></button>
      </li>
    );
  }
  return (
    <li className="step" title="Tap to edit" onClick={() => setEdit(true)}>
      <span className="text">{text}</span>
    </li>
  );
}

function time(at: number) {
  if (Date.now() - at < 3_600_000) return ago(at);
  const d = new Date(at);
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === new Date().toDateString() ? clock : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock}`;
}
