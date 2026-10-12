import { useEffect, useMemo, useRef, useState } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Pending } from './Pending';
import { Composer, Markdown } from './Chat';
import { COMPACT_AT, type ChatEvent } from '../../../shared/protocol';

export type Moment = { id: string; kind: 'you' | 'done' | 'note' | 'fable' | 'reply'; text: string; at: number };

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
      moments.push({ id: e.id, kind: 'you', text: e.text, at: e.at });
    }
    if (e.kind === 'assistant' && e.text.trim()) {
      if (reply >= 0) moments.splice(reply, 1);
      reply = moments.push({ id: e.id, kind: 'reply', text: e.text.trim(), at: e.at }) - 1;
    }
    if (e.kind === 'plan') next = e.next;
    if (e.kind === 'system' && e.text.startsWith('Compact')) moments.push({ id: e.id, kind: e.text.startsWith('Compact failed') ? 'note' : 'done', text: e.text, at: e.at });
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
  const context = useStore((s) => s.session.context);
  const compacting = useStore((s) => s.session.compacting);
  const { moments, next, lastTool, advisor, fable } = useMemo(() => buildTimeline(events), [events]);
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const prompts = moments.map((m, i) => (m.kind === 'you' ? i : -1)).filter((i) => i >= 0);
  const from = all || prompts.length <= SHOWN_PROMPTS ? 0 : prompts[prompts.length - SHOWN_PROMPTS];
  const shown = moments.slice(from);
  const extras = [team && 'Team', advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');
  const setNext = (list: string[]) => send({ type: 'plan', next: list });

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [moments.length, next.length, running, waiting]);

  return (
    <div className="brief">
      <div className="brief-input"><Composer /></div>
      {compacting ? (
        <div className="compact-banner working">
          <Icon name="loading" small spin />
          <span>Compacting the conversation. This takes a minute; the meter drops when it is done.</span>
        </div>
      ) : context !== null && context >= COMPACT_AT && (
        <div className="compact-banner">
          <Icon name="warning" small />
          <span>Context is {Math.round(context / 1000)}k tokens. {running ? 'It compacts automatically when this turn ends.' : 'Compact so Claude stays focused and each turn costs less.'}</span>
          <button disabled={running} title={running ? 'Wait until Claude finishes this turn' : 'Run /compact'} onClick={() => send({ type: 'prompt', text: '/compact' })}>Compact</button>
        </div>
      )}
      <div className="brief-status">
        <div className="timeline-head">
          <span>Timeline</span>
          {extras && <span className="extras">{extras}</span>}
          {from > 0 && <button className="link" onClick={() => setAll(true)}>Show earlier</button>}
          {running && <button className="icon-btn" title="Stop" onClick={() => send({ type: 'interrupt' })}><Icon name="debug-stop" small /></button>}
        </div>
        <ol className="timeline">
          {moments.length === 0 && !running && <li className="tl-empty">Your instructions, finished parts and Claude's plan show up here.</li>}
          {shown.map((m) => <MomentRow key={m.id} m={m} latest={!running && m.kind === 'reply' && m === moments[moments.length - 1]} />)}
          {(running || waiting) && (
            <li className={`tl now ${waiting ? 'waiting' : ''}`}>
              <span className="mark"><Icon name={waiting ? 'bell-dot' : 'loading'} small spin={!waiting} /></span>
              <span className="text">
                {waiting ? 'Waiting for you' : status}
                {!waiting && lastTool?.kind === 'tool_use' && <span className="tool">{lastTool.summary}</span>}
              </span>
            </li>
          )}
          {next.map((t, i) => (
            <Step key={`${i}:${t}`} text={t} onSave={(v) => setNext(next.map((x, j) => (j === i ? v : x)).filter(Boolean))} onDrop={() => setNext(next.filter((_, j) => j !== i))} />
          ))}
          {adding ? (
            <Step text="" editing onSave={(v) => { setAdding(false); if (v) setNext([...next, v]); }} onDrop={() => setAdding(false)} />
          ) : (
            (running || next.length > 0) && <li className="tl add"><button className="link" onClick={() => setAdding(true)}><Icon name="add" small /> Add a step</button></li>
          )}
        </ol>
        <div ref={end} />
      </div>
      {waiting && <div className="brief-cards"><Pending /></div>}
    </div>
  );
}

const MARKS: Record<Moment['kind'], string> = { you: 'account', done: 'check', note: 'flag', fable: 'sparkle', reply: 'comment' };

function MomentRow({ m, latest }: { m: Moment; latest: boolean }) {
  const [toggled, setToggled] = useState(false);
  const open = latest !== toggled;
  return (
    <li className={`tl ${m.kind}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('a, pre, code')) setToggled((v) => !v); }}>
      <span className="mark"><Icon name={MARKS[m.kind]} small /></span>
      {m.kind === 'reply' && open ? <Markdown text={m.text} /> : (
        <span className={`text ${open ? '' : 'clamp'}`}>{m.kind === 'fable' && <b>Fable: </b>}{m.kind === 'reply' ? plain(m.text) : m.text}</span>
      )}
      <span className="when">{time(m.at)}</span>
    </li>
  );
}

function Step({ text, editing = false, onSave, onDrop }: { text: string; editing?: boolean; onSave: (v: string) => void; onDrop: () => void }) {
  const [edit, setEdit] = useState(editing);
  const [value, setValue] = useState(text);
  if (edit) {
    const done = () => { setEdit(false); if (value.trim() !== text) onSave(value.trim()); else if (!text) onDrop(); };
    return (
      <li className="tl next editing">
        <span className="mark"><Icon name="circle-large-outline" small /></span>
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
    <li className="tl next">
      <span className="mark"><Icon name="circle-large-outline" small /></span>
      <span className="text" onClick={() => setEdit(true)}>{text}</span>
      <span className="acts">
        <button className="icon-btn" title="Edit step" onClick={() => setEdit(true)}><Icon name="edit" small /></button>
        <button className="icon-btn" title="Remove step" onClick={onDrop}><Icon name="close" small /></button>
      </span>
    </li>
  );
}

function plain(md: string) {
  return md.replace(/[*`#>]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
