import { useMemo, useState } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { Pending } from './Pending';
import { Summary } from './Summary';
import { Markdown } from './Chat';
import type { ChatEvent } from '../../../shared/protocol';

export function buildBrief(events: ChatEvent[]) {
  const notes: { id: string; text: string; at: number }[] = [];
  let next: string[] = [];
  for (const e of events) {
    if (e.kind === 'user') next = [];
    if (e.kind !== 'tool_use' || !e.name.endsWith('__set_status')) continue;
    if (Array.isArray(e.input.next)) next = e.input.next.filter((x): x is string => typeof x === 'string');
    if (typeof e.input.important === 'string' && e.input.important.trim()) notes.push({ id: e.id, text: e.input.important, at: e.at });
  }
  const lastTool = [...events].reverse().find((e) => e.kind === 'tool_use' && !e.name.endsWith('__set_status'));
  const last = [...events].reverse().find((e) => e.kind === 'result' || e.kind === 'user');
  return { next, notes: notes.reverse(), lastTool, reply: last?.kind === 'result' ? last.text : null };
}

export function Brief() {
  const events = useStore((s) => s.events);
  const status = useStore((s) => s.status);
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const { next, notes, lastTool, reply } = useMemo(() => buildBrief(events), [events]);
  const [allNotes, setAllNotes] = useState(false);
  const [fullReply, setFullReply] = useState(false);
  const now = waiting ? 'Waiting for you' : running ? status : status === 'Connecting' ? status : status && status !== 'Idle' ? status : 'Idle';

  return (
    <div className="brief">
      <div className="brief-scroll">
        <div className="brief-col">
          <section>
            <div className="label">Now</div>
            <div className={`now-line ${running ? 'running' : ''}`}>
              <Icon name={waiting ? 'bell-dot' : running ? 'loading' : 'check'} spin={running && !waiting} />
              <span className="now-text">{now}</span>
              {running && <button className="icon-btn" title="Stop" onClick={() => send({ type: 'interrupt' })}><Icon name="debug-stop" /></button>}
            </div>
            {running && lastTool?.kind === 'tool_use' && <div className="now-tool" title={lastTool.summary}>{lastTool.summary}</div>}
          </section>

          <Pending />

          {next.length > 0 && (
            <section>
              <div className="label">Next</div>
              <ol className="todos">
                {next.map((t, i) => (
                  <li key={i}>
                    <span className="step">{i + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {notes.length > 0 && (
            <section>
              <div className="label">Important</div>
              <ul className="notes">
                {(allNotes ? notes : notes.slice(0, 4)).map((n) => (
                  <li key={n.id}>
                    <Icon name="info" small />
                    <span>{n.text}</span>
                    <span className="when">{time(n.at)}</span>
                  </li>
                ))}
              </ul>
              {notes.length > 4 && <button className="link" onClick={() => setAllNotes((v) => !v)}>{allNotes ? 'Show less' : `Show ${notes.length - 4} earlier`}</button>}
            </section>
          )}

          {reply && !running && (
            <section>
              <div className="label">Last reply</div>
              <div className={`reply ${reply.length > 600 && !fullReply ? 'clamped' : ''}`}><Markdown text={reply} /></div>
              {reply.length > 600 && <button className="link" onClick={() => setFullReply((v) => !v)}>{fullReply ? 'Show less' : 'Show all'}</button>}
            </section>
          )}

          <Summary />
        </div>
      </div>
      <Steer />
    </div>
  );
}

function Steer() {
  const running = useStore((s) => s.session.running);
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    send({ type: 'steer', text: text.trim() });
    setText('');
  };
  return (
    <div className="steer">
      <textarea
        value={text}
        rows={1}
        placeholder={running ? 'Steer Claude: stops the current step and sends this' : 'Tell Claude what to do next'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button className={running ? 'primary steer-btn' : 'primary'} disabled={!text.trim()} onClick={submit}>
        {running ? 'Steer' : 'Send'}
      </button>
    </div>
  );
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
