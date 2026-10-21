import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { send, setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { BlockedCard, Pending } from './Pending';
import { Composer, Markdown } from './Chat';
import { loopLabel } from './Composer';
import { ReadAloud } from './Voice';
import { touch } from '../touch';
import { Row, Transcript } from './Transcript';
import { FileIcon } from './Explorer';
import { relPath } from './steps';
import { BIG_BRO, buildTurns, type Turn } from './turns';
import { AgentsChip } from './AgentsPane';
import { useMacName } from '../MacsPopover';
import type { PendingRequest } from '../../../shared/protocol';

const SHOWN_TURNS = 5;

export function Brief() {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const team = useStore((s) => s.session.team);
  const macName = useMacName();
  const stopping = useStore((s) => s.session.stopping);
  const loop = useStore((s) => s.session.loop);
  const cwd = useStore((s) => s.session.cwd);
  const pending = useStore((s) => s.pending);
  const { turns, next, lastTool, advisor, fable } = useMemo(() => buildTurns(events), [events]);
  const [all, setAll] = useState(false);
  const [full, setFull] = useState(() => localStorage.getItem('agentview.transcript') === '1');
  const pick = (v: boolean) => { setFull(v); localStorage.setItem('agentview.transcript', v ? '1' : '0'); };
  const [adding, setAdding] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(() => { try { return (localStorage.getItem('agentview.steps') ?? (touch() ? '0' : '1')) === '1'; } catch { return !touch(); } });
  const toggleSteps = () => { setStepsOpen(!stepsOpen); try { localStorage.setItem('agentview.steps', stepsOpen ? '0' : '1'); } catch {} };
  const [, tick] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const from = all ? 0 : Math.max(0, turns.length - SHOWN_TURNS);
  const shown = turns.slice(from);
  const extras = [team && 'Team', advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');
  const setNext = (list: string[]) => send({ type: 'plan', next: list });
  const lastReply = [...turns].reverse().find((t) => t.reply)?.reply;
  const hasSteps = next.length > 0 || adding || running;
  const state = waiting ? 'waiting' : stopping ? 'stopping' : running ? 'running' : 'idle';

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns.length, next.length, running, waiting]);

  return (
    <div className="brief">
      <div className="brief-status">
        <div className="timeline-head">
          <button className="tl-view" title={full ? 'Show the timeline' : 'Show the full transcript'} onClick={() => pick(!full)}>
            {full ? 'Transcript' : 'Timeline'}<Icon name="arrow-swap" small />
          </button>
          <span className="spacer" />
          <AgentsChip />
          {macName && <span className="mobile-only mac-here"><Icon name="vm" small /> {macName}</span>}
          {extras && <span className="extras">{extras}</span>}
          <span className="desktop-only"><ReadAloud speak /></span>
        </div>
        {full ? <Transcript /> : (
          <div className="turns">
            {turns.length === 0 && <div className="tl-empty">Send a prompt. Each prompt shows up here with Claude's reply, the files it changed and the commands it ran.</div>}
            {from > 0 && <button className="link tc-earlier" onClick={() => setAll(true)}>Show {from} earlier turn{from === 1 ? '' : 's'}</button>}
            {shown.map((t, i) => {
              const latest = i === shown.length - 1;
              return <TurnCard key={t.id} turn={t} latest={latest} live={latest && running} cwd={cwd} pending={latest ? pending : []} />;
            })}
          </div>
        )}
        <div className="tl-foot">
          <div className={`tl-now ${state}`}>
            <span className="mark"><Icon name={state === 'waiting' ? 'bell-dot' : state === 'idle' ? 'circle-large-outline' : 'loading'} small spin={state === 'running' || state === 'stopping'} /></span>
            <span className="text">
              {state === 'waiting' ? 'Waiting for you' : state === 'stopping' ? 'Stopping…' : state === 'running' ? (loop.phase && ['plan', 'build', 'test'].includes(loop.phase) ? `${loopLabel(loop)} · ${status}` : status) : lastReply ? 'Idle · last reply' : 'Idle'}
              {state === 'running' && lastTool?.kind === 'tool_use' && <span className="tool">{lastTool.summary}</span>}
            </span>
            <span className="side">
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
        </div>
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
      <Facts turn={turn} cwd={cwd} pending={pending} />
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Facts({ turn, cwd, pending }: { turn: Turn; cwd: string; pending: PendingRequest[] }) {
  const [allFiles, setAllFiles] = useState(false);
  const failed = turn.commands.filter((c) => c.error);
  const files = allFiles ? turn.files : turn.files.slice(0, FILES_SHOWN);
  const add = turn.files.reduce((n, f) => n + f.add, 0);
  const del = turn.files.reduce((n, f) => n + f.del, 0);
  const any = pending.length || turn.blocked.length || turn.notes.length || turn.files.length || turn.commits.length || turn.commands.length || turn.agents.length;
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
          <div className="tc-label">Ran {plural(turn.commands.length, 'command')}{failed.length > 0 && <span className="tc-bad">, {failed.length} failed</span>}</div>
          {failed.map((c) => (
            <div key={c.id} className="tc-fail" title={c.error}><span className="tc-cmd">{c.label}</span><span className="tc-err">{c.error}</span></div>
          ))}
        </div>
      )}
      {turn.agents.length > 0 && (
        <div className="tc-agents">
          {turn.agents.map((a) => (
            <button key={a.id} className={`tc-agent ${a.state}`} title={a.label} onClick={() => window.dispatchEvent(new CustomEvent('open-agent', { detail: a.id }))}>
              <i className="tr-ring" /><span className="name">{a.type === BIG_BRO ? `Fable: ${a.label}` : a.label}</span><span className="state">{a.state}</span>
            </button>
          ))}
        </div>
      )}
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
  const ago = Date.now() - at;
  if (ago < 60000) return 'now';
  if (ago < 3600000) return `${Math.floor(ago / 60000)}m`;
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
