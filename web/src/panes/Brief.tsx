import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Pending } from './Pending';
import { Composer, Markdown } from './Chat';
import { loopLabel } from './Composer';
import { ReadAloud } from './Voice';
import { touch } from '../touch';
import { Transcript } from './Transcript';
import { type ChatEvent } from '../../../shared/protocol';

export type Moment = { id: string; kind: 'you' | 'done' | 'note' | 'fable' | 'reply' | 'plan' | 'phase'; text: string; at: number; stopping?: boolean; queued?: boolean };

const PHASE_TEXT: Record<string, string> = { plan: 'Plan · Opus', build: 'Build · Opus', test: 'Test · Sonnet' };

const BIG_BRO = 'big-bro';

export function buildTimeline(events: ChatEvent[]) {
  const moments: Moment[] = [];
  const fableCalls = new Set<string>();
  let next: string[] = [];
  let advisor = 0;
  let reply = -1;
  for (const e of events) {
    if (e.kind === 'user') {
      next = [];
      reply = -1;
      if (e.phase) moments.push({ id: e.id, kind: 'phase', text: e.text.startsWith('Test') ? `Test ${e.text.slice(5)} · Sonnet` : PHASE_TEXT[e.phase] ?? e.text, at: e.at });
      else moments.push({ id: e.id, kind: 'you', text: e.text, at: e.at, stopping: e.stopping, queued: e.queued });
    }
    if (e.kind === 'assistant' && e.text.trim()) {
      if (reply >= 0) moments.splice(reply, 1);
      reply = moments.push({ id: e.id, kind: 'reply', text: e.text.trim(), at: e.at }) - 1;
    }
    if (e.kind === 'plan') {
      next = e.next;
      if (moments.at(-1)?.kind === 'plan') moments.pop();
      moments.push({ id: e.id, kind: 'plan', text: e.next.length ? `You changed the next steps (${e.next.length})` : 'You cleared the next steps', at: e.at });
    }
    if (e.kind === 'system' && e.text.startsWith('Compact')) moments.push({ id: e.id, kind: e.text.startsWith('Compact failed') ? 'note' : 'done', text: e.text, at: e.at });
    if (e.kind === 'system' && e.text.startsWith('Claude woke up')) moments.push({ id: e.id, kind: 'phase', text: e.text, at: e.at });
    if (e.kind === 'system' && e.text.startsWith('Loop ')) moments.push({ id: e.id, kind: e.text.startsWith('Loop passed') ? 'done' : e.text.startsWith('Loop on') || e.text === 'Loop off' ? 'phase' : 'note', text: e.text, at: e.at });
    if (e.kind === 'tool_use' && e.name === 'Advisor') advisor++;
    if (e.kind === 'tool_use' && e.input.subagent_type === BIG_BRO) fableCalls.add(e.id);
    if (e.kind === 'tool_result' && fableCalls.has(e.toolUseId) && !e.isError) moments.push({ id: e.id, kind: 'fable', text: handBack(e.text), at: e.at });
    if (e.kind !== 'tool_use' || !e.name.endsWith('__set_status')) continue;
    if (typeof e.input.done === 'string' && e.input.done.trim()) moments.push({ id: e.id, kind: 'done', text: e.input.done.trim(), at: e.at });
    if (Array.isArray(e.input.next)) next = e.input.next.filter((x): x is string => typeof x === 'string');
    if (typeof e.input.important === 'string' && e.input.important.trim()) moments.push({ id: `${e.id}:note`, kind: 'note', text: e.input.important.trim(), at: e.at });
  }
  const lastTool = [...events].reverse().find((e) => e.kind === 'tool_use' && !e.name.endsWith('__set_status'));
  let later = false;
  const current = moments.reduceRight<Moment[]>((kept, m) => {
    if (m.kind === 'note' && later) return kept;
    if (m.kind === 'done' || m.kind === 'note') later = true;
    return [m, ...kept];
  }, []);
  return { moments: current, next, lastTool, advisor, fable: fableCalls.size };
}

function handBack(text: string) {
  if (!text.startsWith('[Subagent hand-back]')) return text.trim();
  const lines = text.split('\n').slice(1);
  return lines.filter((l) => l.startsWith('  ') || l === '').map((l) => l.slice(2)).join('\n').trim();
}

const SHOWN_PROMPTS = 3;

export function Brief() {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const team = useStore((s) => s.session.team);
  const stopping = useStore((s) => s.session.stopping);
  const loop = useStore((s) => s.session.loop);
  const { moments, next, lastTool, advisor, fable } = useMemo(() => buildTimeline(events), [events]);
  const [all, setAll] = useState(false);
  const [full, setFull] = useState(() => localStorage.getItem('agentview.transcript') === '1');
  const pick = (v: boolean) => { setFull(v); localStorage.setItem('agentview.transcript', v ? '1' : '0'); };
  const [adding, setAdding] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(() => { try { return localStorage.getItem('agentview.steps') !== '0'; } catch { return true; } });
  const toggleSteps = () => { setStepsOpen(!stepsOpen); try { localStorage.setItem('agentview.steps', stepsOpen ? '0' : '1'); } catch {} };
  const [, tick] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const prompts = moments.map((m, i) => (m.kind === 'you' ? i : -1)).filter((i) => i >= 0);
  const from = all || prompts.length <= SHOWN_PROMPTS ? 0 : prompts[prompts.length - SHOWN_PROMPTS];
  const shown = moments.slice(from);
  const extras = [team && 'Team', advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');
  const setNext = (list: string[]) => send({ type: 'plan', next: list });
  const lastReply = [...moments].reverse().find((m) => m.kind === 'reply');
  const hasSteps = next.length > 0 || adding || running;
  const state = waiting ? 'waiting' : stopping ? 'stopping' : running ? 'running' : 'idle';

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [moments.length, next.length, running, waiting]);

  return (
    <div className="brief">
      <div className="brief-status">
        <div className="timeline-head">
          <span className="tl-tabs">
            <button className={full ? '' : 'on'} onClick={() => pick(false)}>Timeline</button>
            <button className={full ? 'on' : ''} onClick={() => pick(true)}>Transcript</button>
          </span>
          <span className="spacer" />
          {extras && <span className="extras">{extras}</span>}
          <ReadAloud />
          {!full && from > 0 && <button className="link" onClick={() => setAll(true)}>Show all</button>}
        </div>
        {full ? <Transcript /> : (
          <ol className="timeline">
            {moments.length === 0 && <li className="tl-empty">Send a prompt. Your messages, finished steps and Claude's replies show up here.</li>}
            {shown.map((m, i) => <MomentRow key={m.id} m={m} sub={m.kind !== 'you' && shown.slice(0, i).some((x) => x.kind === 'you')} />)}
          </ol>
        )}
        <div className="tl-foot">
          <div className={`tl-now ${state}`}>
            <span className="mark"><Icon name={state === 'waiting' ? 'bell-dot' : state === 'idle' ? 'circle-large-outline' : 'loading'} small spin={state === 'running' || state === 'stopping'} /></span>
            <span className="text">
              {state === 'waiting' ? 'Waiting for you' : state === 'stopping' ? 'Stopping…' : state === 'running' ? (loop.phase && ['plan', 'build', 'test'].includes(loop.phase) ? `${loopLabel(loop)} · ${status}` : status) : lastReply ? 'Idle · last reply' : 'Idle'}
              {state === 'running' && lastTool?.kind === 'tool_use' && <span className="tool">{lastTool.summary}</span>}
            </span>
            {state === 'idle' && lastReply && <span className="when" title={new Date(lastReply.at).toLocaleString()}>{time(lastReply.at)}</span>}
          </div>
          {hasSteps && (
            <button className="steps-toggle" aria-expanded={stepsOpen} onClick={toggleSteps}>
              <Icon name={stepsOpen ? 'chevron-down' : 'chevron-right'} small />
              <span>{next.length ? `${next.length} next step${next.length === 1 ? '' : 's'}` : 'Next steps'}</span>
            </button>
          )}
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
const MARKS: Record<Moment['kind'], ReactNode> = {
  you: <Icon name="comment" small />, done: <Icon name="check" small />, note: <i className="dot" />, fable: <Icon name="sparkle" small />, reply: CLAUDE, plan: <Icon name="edit" small />, phase: <Icon name="sync" small />,
};

function MomentRow({ m, sub }: { m: Moment; sub: boolean }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (m.kind === 'reply' && body.current) setLong(body.current.scrollHeight > body.current.clientHeight + 2);
  }, [m.kind, m.text]);
  const when = m.queued ? <span className="tl-state" title="Queued, sends when Claude finishes"><Icon name="clock" small /></span> : m.stopping ? <span className="tl-state" title="Stopping the current step"><Icon name="loading" small spin /></span> : <span className="when" title={new Date(m.at).toLocaleString()}>{time(m.at)}</span>;
  if (m.kind === 'reply') {
    return (
      <li className={`tl reply ${sub ? 'sub' : ''}`}>
        <span className="mark">{MARKS.reply}</span>
        <div className="reply-card">
          <div ref={body} className={`reply-body ${open ? 'open' : long ? 'clipped' : ''}`}><Markdown text={m.text} /></div>
          {(long || open) && <button className="link" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Show more'}</button>}
        </div>
        {when}
      </li>
    );
  }
  return (
    <li className={`tl ${m.kind} ${sub ? 'sub' : ''} ${open ? 'open' : ''}`} title={open ? undefined : m.text} onClick={() => setOpen((v) => !v)}>
      <span className="mark">{MARKS[m.kind]}</span>
      <span className="text">{m.kind === 'fable' && <b>Fable: </b>}{m.text}</span>
      {when}
    </li>
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
      </li>
    );
  }
  return (
    <li className="step">
      <span className="text" onClick={() => { if (!touch()) setEdit(true); }}>{text}</span>
      <span className="acts">
        <button className="icon-btn" title="Edit step" onClick={() => setEdit(true)}><Icon name="edit" small /></button>
        <button className="icon-btn" title="Remove step" onClick={onDrop}><Icon name="close" small /></button>
      </span>
    </li>
  );
}

function time(at: number) {
  const ago = Date.now() - at;
  if (ago < 60000) return 'now';
  if (ago < 3600000) return `${Math.floor(ago / 60000)}m`;
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
