import { useEffect, useMemo, useRef, useState } from 'react';
import { send, useStore } from '../store';
import type { ChatEvent } from '../../../shared/protocol';

export function Chat() {
  const events = useStore((s) => s.events);
  const running = useStore((s) => s.session.running);
  const commands = useStore((s) => s.session.commands);
  const [text, setText] = useState('');
  const [cmdIdx, setCmdIdx] = useState(0);
  const cmdMatches = useMemo(() => {
    const m = /^\/(\S*)$/.exec(text);
    if (!m) return [];
    const needle = m[1].toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().startsWith(needle)).slice(0, 12);
  }, [text, commands]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [events.length, events[events.length - 1]]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send({ type: 'prompt', text: t });
    setText('');
  };

  return (
    <div className="chat">
      <div className="messages">
        {events.map((e) => <Event key={e.id} e={e} />)}
        <div ref={bottom} />
      </div>
      <div className="composer">
        {cmdMatches.length > 0 && (
          <ul className="cmd-popup">
            {cmdMatches.map((c, i) => (
              <li key={c.name} className={i === cmdIdx ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); setText(`/${c.name} `); }}>
                <span>/{c.name}</span>
                <span className="muted small detail">{c.description}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={text}
          rows={2}
          placeholder={running ? 'Claude is working. You can still queue a message.' : 'Tell Claude what to do… type / for commands'}
          onChange={(e) => { setText(e.target.value); setCmdIdx(0); }}
          onKeyDown={(e) => {
            if (cmdMatches.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx((i) => Math.min(i + 1, cmdMatches.length - 1)); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIdx((i) => Math.max(i - 1, 0)); return; }
              if (e.key === 'Tab' || (e.key === 'Enter' && text !== `/${cmdMatches[cmdIdx].name}`)) {
                e.preventDefault();
                setText(`/${cmdMatches[cmdIdx].name} `);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="primary" onClick={submit}>Send</button>
      </div>
    </div>
  );
}

function Event({ e }: { e: ChatEvent }) {
  switch (e.kind) {
    case 'user':
      return <div className="msg user"><pre className="wrap">{e.text}</pre></div>;
    case 'assistant':
      return <div className={`msg assistant ${e.streaming ? 'streaming' : ''}`}><pre className="wrap">{e.text}</pre></div>;
    case 'tool_use':
      if (e.name === 'mcp__agentview__set_status') return null;
      return (
        <details className="msg tool">
          <summary className="mono">{e.summary}</summary>
          <pre className="mono small">{JSON.stringify(e.input, null, 2)}</pre>
        </details>
      );
    case 'tool_result':
      return e.isError ? <pre className="msg tool-error mono small">{e.text}</pre> : null;
    case 'result':
      return <div className="msg result muted small">turn done · ${e.costUsd.toFixed(3)}</div>;
    case 'system':
      return <div className="msg system muted small">{e.text}</div>;
    case 'status':
      return <div className="msg system muted small">● {e.text}</div>;
  }
}
