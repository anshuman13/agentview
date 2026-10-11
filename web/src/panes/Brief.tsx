import { useMemo, useState } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Summary } from './Summary';
import type { ChatEvent } from '../../../shared/protocol';

export function buildBrief(events: ChatEvent[]) {
  const notes: { id: string; text: string; at: number; fable?: boolean }[] = [];
  const fableCalls = new Set<string>();
  let next: string[] = [];
  let advisor = 0;
  for (const e of events) {
    if (e.kind === 'user') next = [];
    if (e.kind === 'tool_use' && e.name === 'Advisor') advisor++;
    if (e.kind === 'tool_use' && e.input.subagent_type === BIG_BRO) fableCalls.add(e.id);
    if (e.kind === 'tool_result' && fableCalls.has(e.toolUseId) && !e.isError) notes.push({ id: e.id, text: handBack(e.text), at: e.at, fable: true });
    if (e.kind !== 'tool_use' || !e.name.endsWith('__set_status')) continue;
    if (Array.isArray(e.input.next)) next = e.input.next.filter((x): x is string => typeof x === 'string');
    if (typeof e.input.important === 'string' && e.input.important.trim()) notes.push({ id: e.id, text: e.input.important, at: e.at });
  }
  const lastTool = [...events].reverse().find((e) => e.kind === 'tool_use' && !e.name.endsWith('__set_status'));
  return { next, notes: notes.reverse(), lastTool, advisor, fable: fableCalls.size };
}

const BIG_BRO = 'big-bro';

function handBack(text: string) {
  if (!text.startsWith('[Subagent hand-back]')) return text.trim();
  const lines = text.split('\n').slice(1);
  return lines.filter((l) => l.startsWith('  ') || l === '').map((l) => l.slice(2)).join('\n').trim();
}

export function Brief() {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const team = useStore((s) => s.session.team);
  const { next, notes, lastTool, advisor, fable } = useMemo(() => buildBrief(events), [events]);
  const [open, setOpen] = useState(false);
  const now = waiting ? 'Waiting for you' : running ? status : status && status !== 'Idle' ? status : 'Idle';
  const extras = [team && 'Team', advisor > 0 && `advisor ${advisor}×`, fable > 0 && `Fable ${fable}×`].filter(Boolean).join(' · ');

  return (
    <div className={`brief-bar ${open ? 'open' : ''}`}>
      <div className={`brief-now ${running ? 'running' : ''}`}>
        <Icon name={waiting ? 'bell-dot' : running ? 'loading' : 'check'} small spin={running && !waiting} />
        <span className="now-text" title={now}>{now}</span>
        {running && lastTool?.kind === 'tool_use' && <span className="now-tool" title={lastTool.summary}>{lastTool.summary}</span>}
        {extras && <span className="extras">{extras}</span>}
        {running && <button className="icon-btn" title="Stop" onClick={() => send({ type: 'interrupt' })}><Icon name="debug-stop" small /></button>}
        <button className="icon-btn" title={open ? 'Show less' : 'Show notes and turns'} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
        </button>
      </div>
      {next.length > 0 && (
        <div className="brief-next" title={next.join('\n')}>
          <span className="k">Next</span>
          {next.map((t, i) => <span key={i} className="step">{t}</span>)}
        </div>
      )}
      {(open ? notes : notes.slice(0, 1)).map((n) => (
        <div key={n.id} className={`brief-note ${n.fable ? 'fable' : ''}`} onClick={() => setOpen(true)}>
          <Icon name={n.fable ? 'sparkle' : 'info'} small />
          <span>{n.fable && <b>Fable: </b>}{n.text}</span>
          <span className="when">{time(n.at)}</span>
        </div>
      ))}
      {open && <Summary />}
    </div>
  );
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
